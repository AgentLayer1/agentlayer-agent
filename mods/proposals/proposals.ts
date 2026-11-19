import { atom, read, update } from 'claude-code';
import type { EngineInterface, On } from 'claude-code';

import { PROPOSALS_FEATURE } from '../shared/catalog';
import { cliArgv, cliError } from '../shared/cli';
import type { Queue } from '../types';
import {
  DECISION_AT_END,
  QUIET_HOURS,
  dayIn,
  decisionInDraft,
  isQuiet,
  parseDecision,
  parseHeartbeat,
  parseList,
  type Decision,
  type ProposalList
} from './beat';

const MINUTE_MS = 60_000;
const USAGE = 'Usage: /propose <start|later|skip> <id>';

// Kept in session state, which outlives a /clear and a reload of this module, unlike its own variables.
const beat = atom({ plugin: 'agentlayer', key: 'heartbeat' } as const, { wokeOn: '', boundId: '' });
// The queue feature's state, whose isBusy says a main-loop turn runs; the heartbeat only reads it.
const QUEUE_IDLE: Queue = { pending: [], isBusy: false, isPaused: false };
const queue = atom({ plugin: 'agentlayer', key: 'queue' } as const, QUEUE_IDLE);

// The wake clock, armed only in the session that is the home's heartbeat.
let ticker: { cancel: () => void } | undefined;
let timeZone: Promise<string | undefined> | undefined;

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

function zoneOf($: EngineInterface): Promise<string | undefined> {
  timeZone ??= runCli($, ['ping']).then(
    (stdout) => (JSON.parse(stdout) as { timezone?: string }).timezone,
    () => undefined
  );
  return timeZone;
}

async function decide($: EngineInterface, { choice, id }: Decision): Promise<string> {
  return said($, ['proposals', 'decide', choice, id]);
}

// The day's first wake clears the conversation first, so the heartbeat's context doesn't grow without end.
async function wake($: EngineInterface): Promise<void> {
  const [now, zone] = await Promise.all([$.clock.now(), zoneOf($)]);
  const today = dayIn(now, zone);
  const { wokeOn } = await read($, beat);
  if (wokeOn && wokeOn !== today) {
    await $.command.run({ command: 'clear' });
  }
  await update($, beat, (current) => ({ ...current, wokeOn: today }));
  $.clock.after(0, () => void $.command.run({ command: `${$.plugin.name}:proposals` }));
}

// The heartbeat is this running session, whichever conversation it is in now: a /clear or a /resume changes the id,
// and the binding moves with it. A ledger naming any other id means another session took over.
const isOwner = (list: ProposalList, sessionId: string, boundId: string): boolean =>
  list.heartbeat !== null && (list.heartbeat.sessionId === sessionId || list.heartbeat.sessionId === boundId);

async function bind($: EngineInterface, sessionId: string, every: string | undefined): Promise<string | Error> {
  const args = ['proposals', 'heartbeat', `--session=${sessionId}`, ...(every ? [`--every=${every}`] : [])];
  return runCli($, args).then(
    async (stdout) => {
      await update($, beat, (current) => ({ ...current, boundId: sessionId }));
      return stdout.trim();
    },
    (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
  );
}

// Free unless every gate passes: this session is the heartbeat, no turn runs, it isn't quiet, and room is left.
async function tick($: EngineInterface): Promise<void> {
  const [list, sessionId, { isBusy }, { boundId }] = await Promise.all([
    readList($),
    $.session.id(),
    read($, queue),
    read($, beat)
  ]);
  if (!list) {
    return;
  }
  if (!list.heartbeat || !isOwner(list, sessionId, boundId)) {
    ticker?.cancel();
    ticker = undefined;
    return;
  }
  if (list.heartbeat.sessionId !== sessionId && (await bind($, sessionId, `${list.heartbeat.everyMinutes}m`)) instanceof Error) {
    return;
  }
  const [now, zone] = await Promise.all([$.clock.now(), zoneOf($)]);
  if (isBusy || isQuiet(now, zone) || list.waiting.length >= list.target) {
    return;
  }
  await wake($);
}

async function arm($: EngineInterface): Promise<void> {
  const [list, sessionId, { boundId }] = await Promise.all([readList($), $.session.id(), read($, beat)]);
  ticker?.cancel();
  ticker = undefined;
  if (list?.heartbeat && isOwner(list, sessionId, boundId)) {
    if (list.heartbeat.sessionId === sessionId && boundId !== sessionId) {
      await update($, beat, (current) => ({ ...current, boundId: sessionId }));
    }
    ticker = $.clock.every(list.heartbeat.everyMinutes * MINUTE_MS, () => void tick($));
  }
}

async function status($: EngineInterface): Promise<string> {
  const [list, sessionId, now, zone, { boundId }] = await Promise.all([
    readList($),
    $.session.id(),
    $.clock.now(),
    zoneOf($),
    read($, beat)
  ]);
  if (!list) {
    return "Couldn't read the proposals.";
  }
  const waiting = `${list.waiting.length} of ${list.target} proposals waiting`;
  if (!list.heartbeat) {
    return `No heartbeat. ${waiting}. /heartbeat makes this session the one.`;
  }
  const who = isOwner(list, sessionId, boundId) ? 'This session' : 'Another session';
  const quiet = isQuiet(now, zone) ? `quiet now (${QUIET_HOURS})` : `quiet ${QUIET_HOURS}`;
  return `${who} is the heartbeat, every ${list.heartbeat.everyMinutes}m, ${quiet}. ${waiting}.`;
}

async function heartbeat($: EngineInterface, args: string): Promise<string> {
  const ask = parseHeartbeat(args);
  if (ask.kind === 'status') {
    return status($);
  }
  if (ask.kind === 'now') {
    // After this command returns: a clear run from inside it would wait on the command itself.
    $.clock.after(0, () => void wake($));
    return 'Looking for proposals now.';
  }
  if (ask.kind === 'off') {
    const text = await said($, ['proposals', 'heartbeat', '--off']);
    await update($, beat, (current) => ({ ...current, boundId: '' }));
    await arm($);
    return text;
  }
  const bound = await bind($, await $.session.id(), ask.every || undefined);
  await arm($);
  return bound instanceof Error ? bound.message : bound;
}

export const registerProposals = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await Promise.all(PROPOSALS_FEATURE.commands.map((command) => $.command.register(command)));
    $.clock.after(0, () => void arm($));
    return next(e);
  });

  on('command.run', { command: 'propose' }, async ($, e) => {
    const decision = parseDecision(e.args);
    return { text: decision ? await decide($, decision) : USAGE };
  });

  on('command.run', { command: 'heartbeat' }, async ($, e) => ({ text: await heartbeat($, e.args) }));

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
