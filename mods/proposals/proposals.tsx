import { atom, read, update } from 'claude-code';
import type { EngineInterface, On } from 'claude-code';

import { PROPOSALS_FEATURE } from '../shared/catalog';
import { cliArgv, cliError } from '../shared/cli';
import { TURN_REASONS } from '../shared/turns';
import { clip } from '../tasks/task';
import type { Queue } from '../types';
import {
  CHOICES,
  DECISION_AT_END,
  MINUTE_MS,
  clockIn,
  closingLine,
  dayIn,
  decisionInDraft,
  lastWrite,
  logged,
  nextLook,
  parseDecision,
  parseHeartbeat,
  parseList,
  type Decision,
  type ProposalList
} from './beat';

const USAGE = `Usage: /proposal <${CHOICES.join('|')}> <id>`;
// Inside the engine's short bound on every session.end hook.
const RELEASE_TIMEOUT_MS = 1000;

// Kept in session state, which outlives a /clear and a reload of this module, unlike its own variables.
const beat = atom({ plugin: 'agentlayer', key: 'heartbeat' } as const, { wokeOn: '', owner: '' });
// The queue feature's state, whose isBusy says a main-loop turn runs; the heartbeat only reads it.
const QUEUE_IDLE: Queue = { pending: [], isBusy: false, isPaused: false };
const queue = atom({ plugin: 'agentlayer', key: 'queue' } as const, QUEUE_IDLE);

// The wake clock, armed only in the session that is the home's heartbeat.
let ticker: { cancel: () => void } | undefined;

// The session root, not its cwd: a shell `cd` in a turn moves the cwd out of the home.
async function runCli($: EngineInterface, args: readonly string[]): Promise<string> {
  const { exitCode, stdout, stderr } = await $.process.run(cliArgv($.plugin.root, args), {
    cwd: await $.session.root()
  });
  if (exitCode !== 0) {
    throw cliError(stderr, args, exitCode);
  }
  return stdout;
}

async function said($: EngineInterface, args: readonly string[]): Promise<string> {
  return runCli($, args).then(
    (stdout) => stdout.trim(),
    (error: unknown) => (error instanceof Error ? error.message : String(error))
  );
}

async function readList($: EngineInterface): Promise<ProposalList | null> {
  return runCli($, ['proposals', 'list', '--json']).then(parseList, () => null);
}

async function decide($: EngineInterface, { choice, id }: Decision): Promise<string> {
  return said($, ['proposals', 'decide', choice, id]);
}

function refill($: EngineInterface): void {
  $.clock.after(0, () => void $.command.run({ command: `${$.plugin.name}:proposals` }));
}

// The day's first wake clears the conversation first, so the heartbeat's context doesn't grow without end.
async function wake($: EngineInterface, now: number, zone: string): Promise<void> {
  const today = dayIn(now, zone);
  const { wokeOn } = await read($, beat);
  if (wokeOn && wokeOn !== today) {
    const clearedId = await $.session.id();
    await update($, beat, (current) => ({ ...current, clearedId }));
    await $.command.run({ command: 'clear' });
  }
  await update($, beat, (current) => ({ ...current, wokeOn: today, awaiting: [...(current.awaiting ?? []), 'look'] }));
  refill($);
}

async function note($: EngineInterface, at: number, text: string): Promise<void> {
  await update($, beat, (current) => ({ ...current, log: logged(current.log ?? [], { at, text }) }));
}

// Each tick, whatever it decides, moves the band's clock on and says what it saw.
async function ticked($: EngineInterface, list: Bound, now: number, text: string): Promise<void> {
  await update($, beat, (current) => ({
    ...current,
    nextAt: now + list.heartbeat.everyMinutes * MINUTE_MS,
    showing: list.showing.length,
    target: list.target
  }));
  if (text) {
    await note($, now, text);
  }
}

// The heartbeat is this running process, named by a token it picks once and keeps in session state: a /clear or a
// /resume changes the conversation id, but not the token, and no other process holds it.
async function ownerOf($: EngineInterface): Promise<string> {
  const { owner } = await read($, beat);
  if (owner) {
    return owner;
  }
  const [sessionId, now] = await Promise.all([$.session.id(), $.clock.now()]);
  const token = `${sessionId}@${now.toString(36)}`;
  await update($, beat, (current) => ({ ...current, owner: token }));
  return token;
}

type Bound = ProposalList & { heartbeat: NonNullable<ProposalList['heartbeat']> };

const isOwner = (list: ProposalList | null, owner: string): list is Bound =>
  owner !== '' && list?.heartbeat?.owner === owner;

// The newest write to any other session's transcript in this home's folder, the heartbeat's own and the one its last
// /clear left behind skipped; null when the engine keeps no transcript to find the folder by.
async function lastUse($: EngineInterface): Promise<number | null> {
  const [{ transcriptPath }, id, { clearedId }] = await Promise.all([$.session.info(), $.session.id(), read($, beat)]);
  const folder = transcriptPath.slice(0, transcriptPath.lastIndexOf('/'));
  const entries = folder ? await $.fs.list(folder).catch(() => null) : null;
  return entries && lastWrite(entries, [id, clearedId ?? '']);
}

async function tick($: EngineInterface): Promise<void> {
  const [list, { isBusy }, { owner }] = await Promise.all([readList($), read($, queue), read($, beat)]);
  if (!list) {
    return;
  }
  if (!isOwner(list, owner)) {
    // The clock only runs in the session that was the heartbeat, so this session just lost the job.
    if (ticker) {
      void $.ui.toast(
        list.heartbeat
          ? 'Another session took over the heartbeat; this one stopped looking for proposals.'
          : 'The heartbeat was turned off; this session stopped looking for proposals.'
      );
    }
    ticker?.cancel();
    ticker = undefined;
    await update($, beat, (current) => ({ ...current, isHeartbeat: false }));
    return;
  }
  const now = await $.clock.now();
  if (isBusy) {
    await ticked($, list, now, 'skipped: a turn was running');
    return;
  }
  const used = await lastUse($);
  // A home it can't see is treated as in use, since skipping would stop the heartbeat for good.
  if (used !== null && now - used >= list.heartbeat.everyMinutes * MINUTE_MS) {
    await ticked($, list, now, 'skipped: home idle');
    return;
  }
  await ticked($, list, now, '');
  await wake($, now, list.timezone);
}

// Only a process that ran /heartbeat holds a token, so every other session starts without reading the ledger.
async function arm($: EngineInterface): Promise<Bound | null> {
  const { owner } = await read($, beat);
  ticker?.cancel();
  ticker = undefined;
  if (!owner) {
    return null;
  }
  const list = await readList($);
  if (!isOwner(list, owner)) {
    await update($, beat, (current) => ({ ...current, isHeartbeat: false }));
    return null;
  }
  const { everyMinutes } = list.heartbeat;
  const now = await $.clock.now();
  ticker = $.clock.every(everyMinutes * MINUTE_MS, () => void tick($));
  await update($, beat, (current) => ({
    ...current,
    isHeartbeat: true,
    everyMinutes,
    zone: list.timezone,
    nextAt: now + everyMinutes * MINUTE_MS,
    showing: list.showing.length,
    target: list.target
  }));
  return list;
}

async function status($: EngineInterface): Promise<string> {
  const [list, now, { owner }, used] = await Promise.all([readList($), $.clock.now(), read($, beat), lastUse($)]);
  if (!list) {
    return "Couldn't read the proposals.";
  }
  const showing = `${list.showing.length} of ${list.target} proposals showing`;
  if (!list.heartbeat) {
    return `No heartbeat. ${showing}. /heartbeat makes this session the one.`;
  }
  const mine = isOwner(list, owner);
  const who = mine ? 'This session' : 'Another session';
  const seen = used === null ? "its sessions can't be seen" : used === 0 ? 'no other session yet' : `last activity ${Math.round((now - used) / MINUTE_MS)}m ago`;
  const { nextAt } = await read($, beat);
  const next = mine && nextAt ? ` Its ${nextLook(nextAt, now, list.timezone)}.` : '';
  return `${who} is the heartbeat, every ${list.heartbeat.everyMinutes}m, skipping a wake when no other session in the home was active in that time (${seen}). ${showing}.${next}`;
}

async function heartbeat($: EngineInterface, args: string): Promise<string> {
  const ask = parseHeartbeat(args);
  if (ask.kind === 'status') {
    return status($);
  }
  if (ask.kind === 'now') {
    // A refill only: the day's clear belongs to the heartbeat's own clock, never to a session that asked for one.
    await update($, beat, (current) =>
      current.isHeartbeat ? { ...current, awaiting: [...(current.awaiting ?? []), 'look'] } : current
    );
    refill($);
    return 'Looking for proposals now.';
  }
  if (ask.kind === 'off') {
    const text = await said($, ['proposals', 'heartbeat', '--off']);
    await arm($);
    return text;
  }
  const every = ask.every ? [`--every=${ask.every}`] : [];
  const text = await said($, ['proposals', 'heartbeat', `--owner=${await ownerOf($)}`, ...every]);
  return `${text}${await firstLook($, await arm($))}`;
}

async function firstLook($: EngineInterface, list: Bound | null): Promise<string> {
  if (!list) {
    return '';
  }
  const now = await $.clock.now();
  $.clock.after(0, () => void wake($, now, list.timezone));
  return ' Looking for proposals now.';
}

export const registerProposals = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await Promise.all(PROPOSALS_FEATURE.commands.map((command) => $.command.register(command)));
    $.clock.after(0, () => void arm($));
    return next(e);
  });

  // A /clear or a /resume keeps this process, and with it the heartbeat; only leaving it gives the heartbeat up. A crash
  // runs no hook, which is why a later /heartbeat still says it replaced one.
  on('session.end', { reason: ['prompt_input_exit', 'logout', 'other'] }, async ($, e, next) => {
    const { owner } = await read($, beat);
    if (owner) {
      await $.process
        .run(cliArgv($.plugin.root, ['proposals', 'heartbeat', '--release', `--owner=${owner}`]), {
          cwd: await $.session.root(),
          timeoutMs: RELEASE_TIMEOUT_MS
        })
        .catch(() => undefined);
    }
    return next(e);
  });

  on('command.run', { command: 'proposal' }, async ($, e) => {
    const decision = parseDecision(e.args);
    return { text: decision ? await decide($, decision) : USAGE };
  });

  on('command.run', { command: 'heartbeat' }, async ($, e) => ({ text: await heartbeat($, e.args) }));

  // A wake's turn ends on the skill's one-line ending, which is what the band says it did.
  on('turn.complete', { reason: TURN_REASONS }, async ($, e, next) => {
    const { awaiting = [] } = await read($, beat);
    const kind = awaiting[0];
    if (e.agentId === undefined && kind) {
      const [now, line] = [await $.clock.now(), closingLine(e.answer)];
      const verb = kind === 'refresh' ? 'refreshed' : 'looked';
      await update($, beat, (current) => ({ ...current, awaiting: (current.awaiting ?? []).slice(1) }));
      await note($, now, e.reason === 'answer' ? `${verb}: ${line || 'done'}` : `${verb}: stopped (${e.reason})`);
    }
    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    const state = await read($, beat);
    if (!state.isHeartbeat || e.props.hasSurvey) {
      return below;
    }
    const { Box, Text } = $.ui.resolve(e);
    const zone = state.zone ?? 'UTC';
    const now = await $.clock.now();
    const head = [
      `every ${state.everyMinutes ?? 55}m`,
      state.nextAt ? nextLook(state.nextAt, now, zone) : '',
      state.target ? `${state.showing ?? 0} of ${state.target} showing` : ''
    ].filter(Boolean);
    const width = Math.max(20, e.props.bodyColumns - 2);
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color="magenta">💓</Text>
          <Text weight="semibold">Heartbeat</Text>
          <Text dimColor>{head.join(' · ')}</Text>
        </Box>
        {(state.log ?? []).map((event) => (
          <Box paddingLeft={3} gap={1}>
            <Text dimColor>{clockIn(event.at, zone)}</Text>
            <Text>{clip(event.text, width - 6)}</Text>
          </Box>
        ))}
        {below}
      </Box>
    );
  });

  // A sidebar click can land after a half-written prompt; the decision runs, the prompt never reaches the model, and
  // the draft goes back in the box.
  on('prompt.submit', { text: DECISION_AT_END }, async ($, e, next) => {
    const found = e.command ? null : decisionInDraft(e.text);
    if (!found) {
      return next(e);
    }
    const text = await decide($, found);
    if (found.draft) {
      $.clock.after(0, () => void $.prompt.fill({ text: found.draft, mode: 'replace' }));
    }
    return { drop: text };
  });
};
