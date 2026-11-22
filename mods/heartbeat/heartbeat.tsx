import { atom, read, update } from 'claude-code';
import type { EngineInterface, On } from 'claude-code';

import { HEARTBEAT_FEATURE } from '../shared/catalog';
import { cliArgv, cliError } from '../shared/cli';
import { TURN_REASONS } from '../shared/turns';
import { clip } from '../tasks/task';
import type { HeartbeatEvent, Queue } from '../types';
import {
  CHOICES,
  MINUTE_MS,
  REFRESH_RETRY_MS,
  ago,
  clockIn,
  closingLine,
  dayIn,
  eventView,
  isLate,
  lastWrite,
  logged,
  nextLook,
  noticeText,
  notesSent,
  parseAsk,
  parseStatus,
  workspaceTitles,
  NOTE_CHOICES,
  NOTE_DECISION,
  PROPOSAL_DECISION,
  type Decision,
  type NoteChoice,
  type HeartbeatStatus
} from './beat';

const USAGE = `Usage: /proposal <${CHOICES.join('|')}> <id> [--workspace=<id>]`;
const NOTE_USAGE = `Usage: /note <${NOTE_CHOICES.join('|')}> <id> [--workspace=<id>]`;
// Inside the engine's short bound on every session.end hook.
const RELEASE_TIMEOUT_MS = 1000;
// TODO(windows): cmux is a macOS app, found only in /Applications.
const CMUX_BIN = '/Applications/cmux.app/Contents/Resources/bin/cmux';
const CMUX_TIMEOUT_MS = 5000;

// Kept in session state, which outlives a /clear and a reload of this module, unlike its own variables.
const beat = atom({ plugin: 'agentlayer', key: 'heartbeat' } as const, { wokeOn: '', owner: '' });
// The queue feature's state, whose isBusy says a main-loop turn runs; the heartbeat only reads it.
const QUEUE_IDLE: Queue = { pending: [], isBusy: false, isPaused: false };
const queue = atom({ plugin: 'agentlayer', key: 'queue' } as const, QUEUE_IDLE);

// Bumped each minute so the band's countdown stays true between ticks; it costs no model turn.
const redrawn = atom({ plugin: 'agentlayer', key: 'heartbeatRedraw' } as const, 0);

// The wake clock and the band's redraw, armed only in the session that is the home's heartbeat.
let ticker: { cancel: () => void } | undefined;
let redraw: { cancel: () => void } | undefined;

const stopClocks = (): void => {
  ticker?.cancel();
  redraw?.cancel();
  ticker = undefined;
  redraw = undefined;
};

// A look overdue by more than this means its clock stopped, not that it is running a little late.
const STALL_MS = 2 * MINUTE_MS;

// Claude Code ends an interval for good, and says nothing, when one period's dispatch is refused. So the two clocks
// keep each other alive: every look starts the redraw afresh, and every redraw restarts a look clock it finds stopped.
function startLooks($: EngineInterface, everyMinutes: number): void {
  ticker?.cancel();
  ticker = $.clock.every(everyMinutes * MINUTE_MS, () => void tick($));
}

function startRedraw($: EngineInterface): void {
  redraw?.cancel();
  redraw = $.clock.every(MINUTE_MS, () => void onRedraw($));
}

async function onRedraw($: EngineInterface): Promise<void> {
  await update($, redrawn, (count) => count + 1);
  await revive($);
}

async function revive($: EngineInterface): Promise<void> {
  const { isHeartbeat, nextAt, everyMinutes, zone = 'UTC' } = await read($, beat);
  const now = await $.clock.now();
  if (!isHeartbeat || nextAt === undefined || everyMinutes === undefined || now - nextAt <= STALL_MS) {
    return;
  }
  startLooks($, everyMinutes);
  await update($, beat, (current) => ({ ...current, nextAt: now + everyMinutes * MINUTE_MS }));
  await note($, { at: now, kind: 'stopped', text: `the look due ${clockIn(nextAt, zone)} never came; the clock restarted` });
  await tick($);
}

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

async function readStatus($: EngineInterface): Promise<HeartbeatStatus | null> {
  return runCli($, ['heartbeat', 'status', '--json']).then(parseStatus, () => null);
}

async function decide($: EngineInterface, { choice, id, workspace }: Decision): Promise<string> {
  return said($, ['proposals', 'decide', choice, id, ...(workspace ? [`--workspace=${workspace}`] : [])]);
}

async function noteSaid($: EngineInterface, { choice, id, workspace }: Decision<NoteChoice>): Promise<string> {
  if (choice !== 'start') {
    return said($, ['notes', 'react', choice, id]);
  }
  return said($, ['notes', 'start', id, ...(workspace ? [`--workspace=${workspace}`] : [])]);
}

// A decision's answer in place of the prompt it ended, with the draft typed before it put back in the box.
function dropped($: EngineInterface, text: string, draft: string): { drop: string } {
  if (draft) {
    $.clock.after(0, () => void $.prompt.fill({ text: draft, mode: 'replace' }));
  }
  return { drop: text };
}

// The open workspaces' titles, so the look can name the one each proposal belongs in; none when cmux can't answer.
async function workspacesNow($: EngineInterface): Promise<string[]> {
  const listed = await $.process.run([CMUX_BIN, 'workspace', 'list'], { timeoutMs: CMUX_TIMEOUT_MS }).catch(() => null);
  return listed?.exitCode === 0 ? workspaceTitles(listed.stdout) : [];
}

// Queued just before its command runs, so a prompt typed while cmux answers isn't read as the wake's turn.
async function expectTurn($: EngineInterface, kind: string): Promise<void> {
  const now = await $.clock.now();
  await update($, beat, (current) =>
    current.isHeartbeat
      ? {
          ...current,
          awaiting: [...(current.awaiting ?? []), kind],
          workingSince: current.awaiting?.length ? current.workingSince : now
        }
      : current
  );
}

async function look($: EngineInterface): Promise<void> {
  const titles = await workspacesNow($);
  await expectTurn($, 'look');
  await $.command.run({
    command: `${$.plugin.name}:proposals`,
    args: titles.length ? `workspaces: ${JSON.stringify(titles)}` : ''
  });
}

// A brain refresh and the day's first wake clear the conversation first, so the heartbeat's context stays small. A
// refresh runs sync's maintenance steps, then the look reads the brain it left.
async function wake($: EngineInterface, now: number, status: HeartbeatStatus, refresh = false): Promise<void> {
  const today = dayIn(now, status.timezone);
  const { wokeOn } = await read($, beat);
  const clears = refresh || (wokeOn !== '' && wokeOn !== today);
  if (clears) {
    const clearedId = await $.session.id();
    await update($, beat, (current) => ({ ...current, clearedId, awaiting: [] }));
    await $.command.run({ command: 'clear' });
  }
  // A refresh is tried once per window, so one that fails before it stamps doesn't run again on every tick.
  await update($, beat, (current) => ({ ...current, wokeOn: today, ...(refresh ? { refreshTriedAt: now } : {}) }));
  $.clock.after(0, async () => {
    if (refresh) {
      await expectTurn($, 'refresh');
      await $.command.run({ command: `${$.plugin.name}:sync`, args: 'brain' });
      await scout($, status);
    }
    await look($);
  });
}

// Scouting for notes rides on the refresh, reading the brain it just compiled, while the day has room.
async function scout($: EngineInterface, status: HeartbeatStatus): Promise<void> {
  if (!status.notes.room) {
    return;
  }
  await update($, beat, (current) => ({ ...current, notesThisWake: 0 }));
  await expectTurn($, 'notes');
  await $.command.run({ command: `${$.plugin.name}:notes` });
}

async function note($: EngineInterface, event: HeartbeatEvent): Promise<void> {
  await update($, beat, (current) => ({ ...current, log: logged(current.log ?? [], event) }));
}

const refreshedMs = (status: HeartbeatStatus): number => Date.parse(status.refreshedAt) || 0;

const facts = (status: HeartbeatStatus) => ({
  showing: status.proposals.showing,
  target: status.proposals.target,
  refreshedAt: refreshedMs(status)
});

const seen = (status: Bound, now: number) => ({ nextAt: now + status.heartbeat.everyMinutes * MINUTE_MS, ...facts(status) });

async function ticked($: EngineInterface, status: Bound, now: number, skipped = ''): Promise<void> {
  await update($, beat, (current) => ({ ...current, ...seen(status, now) }));
  if (skipped) {
    await note($, { at: now, kind: 'skip', text: skipped });
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

type Bound = HeartbeatStatus & { heartbeat: NonNullable<HeartbeatStatus['heartbeat']> };

const isOwner = (status: HeartbeatStatus | null, owner: string): status is Bound =>
  owner !== '' && status?.heartbeat?.owner === owner;

// The newest write to any other session's transcript in this home's folder, the heartbeat's own and the one its last
// /clear left behind skipped; null when the engine keeps no transcript to find the folder by.
async function lastUse($: EngineInterface): Promise<number | null> {
  const [{ transcriptPath }, id, { clearedId }] = await Promise.all([$.session.info(), $.session.id(), read($, beat)]);
  const folder = transcriptPath.slice(0, transcriptPath.lastIndexOf('/'));
  const entries = folder ? await $.fs.list(folder).catch(() => null) : null;
  return entries && lastWrite(entries, [id, clearedId ?? '']);
}

async function tick($: EngineInterface): Promise<void> {
  const [status, { isBusy }, { owner }] = await Promise.all([readStatus($), read($, queue), read($, beat)]);
  if (!status) {
    return;
  }
  if (!isOwner(status, owner)) {
    // The clock only runs in the session that was the heartbeat, so this session just lost the job.
    if (ticker) {
      void $.ui.toast(
        status.heartbeat
          ? 'Another session took over the heartbeat; this one stopped looking for proposals.'
          : 'The heartbeat was turned off; this session stopped looking for proposals.'
      );
    }
    stopClocks();
    await update($, beat, (current) => ({ ...current, isHeartbeat: false }));
    return;
  }
  startRedraw($);
  const now = await $.clock.now();
  if (isBusy) {
    await ticked($, status, now, 'a turn was running');
    return;
  }
  const used = await lastUse($);
  const { refreshTriedAt = 0 } = await read($, beat);
  // A refresh waits for something to absorb: a session written since the last sync or refresh.
  const absorbs = used === null || used > refreshedMs(status);
  if (status.refreshDue && absorbs && now - refreshTriedAt >= REFRESH_RETRY_MS) {
    await ticked($, status, now);
    await wake($, now, status, true);
    return;
  }
  // A home it can't see is treated as in use, since skipping would stop the heartbeat for good.
  if (used !== null && now - used >= status.heartbeat.everyMinutes * MINUTE_MS) {
    await ticked($, status, now, 'home idle');
    return;
  }
  await ticked($, status, now);
  await wake($, now, status);
}

// Only a process that ran /heartbeat holds a token, so every other session starts without reading its status.
async function arm($: EngineInterface): Promise<Bound | null> {
  const { owner } = await read($, beat);
  stopClocks();
  if (!owner) {
    return null;
  }
  const status = await readStatus($);
  if (!isOwner(status, owner)) {
    await update($, beat, (current) => ({ ...current, isHeartbeat: false }));
    return null;
  }
  const { everyMinutes } = status.heartbeat;
  const now = await $.clock.now();
  startLooks($, everyMinutes);
  startRedraw($);
  await update($, beat, (current) => ({
    ...current,
    isHeartbeat: true,
    everyMinutes,
    zone: status.timezone,
    ...seen(status, now)
  }));
  return status;
}

async function describe($: EngineInterface): Promise<string> {
  const [status, now, { owner, nextAt }, used] = await Promise.all([readStatus($), $.clock.now(), read($, beat), lastUse($)]);
  if (!status) {
    return "Couldn't read the heartbeat's status.";
  }
  const showing = `${status.proposals.showing} of ${status.proposals.target} proposals showing`;
  if (!status.heartbeat) {
    return `No heartbeat. ${showing}. /heartbeat makes this session the one.`;
  }
  const mine = isOwner(status, owner);
  const who = mine ? 'This session' : 'Another session';
  const activity = used === null ? "its sessions can't be seen" : used === 0 ? 'no other session yet' : `last activity ${Math.round((now - used) / MINUTE_MS)}m ago`;
  const next = mine && nextAt ? ` Its ${nextLook(nextAt, now, status.timezone)}.` : '';
  return `${who} is the heartbeat, every ${status.heartbeat.everyMinutes}m, skipping a wake when no other session in the home was active in that time (${activity}). ${showing}.${next}`;
}

async function heartbeat($: EngineInterface, args: string): Promise<string> {
  const ask = parseAsk(args);
  // A look the operator asks for, or a status check, also finds a look clock that stopped.
  if (ask.kind === 'status' || ask.kind === 'now') {
    await revive($);
  }
  if (ask.kind === 'status') {
    return describe($);
  }
  if (ask.kind === 'now') {
    // The heartbeat's own tab refreshes the brain first when one is due; anywhere else it is a refill only, since a
    // clear belongs to the heartbeat, never to a session that asked for a look.
    const [status, { owner }] = await Promise.all([readStatus($), read($, beat)]);
    if (isOwner(status, owner) && status.refreshDue) {
      const now = await $.clock.now();
      $.clock.after(0, () => void wake($, now, status, true));
      return 'Refreshing the brain, then looking for proposals.';
    }
    $.clock.after(0, () => void look($));
    return 'Looking for proposals now.';
  }
  if (ask.kind === 'off') {
    const text = await said($, ['heartbeat', 'off']);
    await arm($);
    return text;
  }
  const every = ask.every ? [`--every=${ask.every}`] : [];
  const text = await said($, ['heartbeat', 'bind', `--owner=${await ownerOf($)}`, ...every]);
  return `${text}${await firstLook($, await arm($))}`;
}

async function firstLook($: EngineInterface, status: Bound | null): Promise<string> {
  if (!status) {
    return '';
  }
  const now = await $.clock.now();
  $.clock.after(0, () => void wake($, now, status));
  return ' Looking for proposals now.';
}

export const registerHeartbeat = (on: On): void => {
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await Promise.all(HEARTBEAT_FEATURE.commands.map((command) => $.command.register(command)));
    $.clock.after(0, () => void arm($));
    return next(e);
  });

  // A /clear or a /resume keeps this process, and with it the heartbeat; only leaving it gives the heartbeat up. A crash
  // runs no hook, which is why a later /heartbeat still says it replaced one.
  on('session.end', { reason: ['prompt_input_exit', 'logout', 'other'] }, async ($, e, next) => {
    const { owner } = await read($, beat);
    if (owner) {
      await $.process
        .run(cliArgv($.plugin.root, ['heartbeat', 'release', `--owner=${owner}`]), {
          cwd: await $.session.root(),
          timeoutMs: RELEASE_TIMEOUT_MS
        })
        .catch(() => undefined);
    }
    return next(e);
  });

  on('command.run', { command: 'proposal' }, async ($, e) => {
    const decision = PROPOSAL_DECISION.parse(e.args);
    return { text: decision ? await decide($, decision) : USAGE };
  });

  on('command.run', { command: 'heartbeat' }, async ($, e) => ({ text: await heartbeat($, e.args) }));

  on('command.run', { command: 'note' }, async ($, e) => {
    const decision = NOTE_DECISION.parse(e.args);
    return { text: decision ? await noteSaid($, decision) : NOTE_USAGE };
  });

  // A note the session sends lands in its scrollback as a notice the model never reads; the heartbeat's band counts it.
  on('tool.call', { tool: /__note_add$/ }, async ($, e, next) => {
    const result = await next(e);
    const sent = notesSent(result.text ?? '');
    if (sent?.notes.length) {
      await Promise.all(
        sent.notes.map((item) => $.session.append({ message: { type: 'system', content: [{ type: 'text', text: noticeText(item) }] } }))
      );
      const [now, { zone = 'UTC' }] = await Promise.all([$.clock.now(), read($, beat)]);
      await update($, beat, (current) => ({
        ...current,
        notesDay: dayIn(now, zone),
        notesSent: sent.today,
        notesCap: sent.cap,
        notesThisWake: (current.notesThisWake ?? 0) + sent.notes.length
      }));
    }
    return result;
  });

  // A wake's turn ends on the skill's one-line ending, which is what the band says it did.
  on('turn.complete', { reason: TURN_REASONS }, async ($, e, next) => {
    const { awaiting = [] } = await read($, beat);
    const kind = awaiting[0];
    if (e.agentId === undefined && kind) {
      const [now, { notesThisWake = 0 }] = await Promise.all([$.clock.now(), read($, beat)]);
      const done = kind === 'refresh' || kind === 'notes' ? kind : 'look';
      await update($, beat, (current) => ({ ...current, awaiting: (current.awaiting ?? []).slice(1), workingSince: now }));
      const last = awaiting.length === 1;
      await note(
        $,
        e.reason === 'answer'
          ? { at: now, kind: done, text: closingLine(e.answer) || 'done', ...(done === 'notes' ? { sent: notesThisWake } : {}) }
          : { at: now, kind: 'stopped', text: `the ${done} stopped (${e.reason})` }
      );
      // What the wake changed (proposals, the tasks summary, the brain) shows once its last turn ends, here and on the
      // dashboard and sidebar.
      if (last) {
        $.clock.after(0, async () => {
          const status = await readStatus($);
          if (status) {
            await update($, beat, (current) => ({ ...current, ...facts(status) }));
          }
          await runCli($, ['dashboard']).catch(() => undefined);
        });
      }
    }
    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e);
    const state = await read($, beat);
    if (!state.isHeartbeat || e.props.hasSurvey) {
      return below;
    }
    await read($, redrawn);
    const { Box, Text } = $.ui.resolve(e);
    const zone = state.zone ?? 'UTC';
    const now = await $.clock.now();
    const working = state.awaiting?.[0];
    const late = state.nextAt !== undefined && isLate(state.nextAt, now);
    // Drawing the band is the last place left to notice when both clocks have stopped.
    if (state.nextAt !== undefined && now - state.nextAt > STALL_MS) {
      $.clock.after(0, () => void revive($));
    }
    const facts = [
      `every ${state.everyMinutes ?? 55}m`,
      state.target ? `${state.showing ?? 0} of ${state.target} proposals showing` : '',
      state.refreshedAt ? `brain refreshed ${ago(state.refreshedAt, now)}` : '',
      state.notesSent && state.notesDay === dayIn(now, zone) ? `${state.notesSent} of ${state.notesCap ?? state.notesSent} notes today` : ''
    ].filter(Boolean);
    // The time, the mark and the gaps around them.
    const width = Math.max(20, e.props.bodyColumns - 13);
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color="magenta">💓</Text>
          <Text weight="semibold">Heartbeat</Text>
          {working ? (
            <Text color="magenta">
              {`◉ ${working === 'refresh' ? 'refreshing the brain' : 'looking for proposals'}…${
                state.workingSince ? ` since ${clockIn(state.workingSince, zone)}` : ''
              }`}
            </Text>
          ) : state.nextAt ? (
            <Text color={late ? 'yellow' : undefined} dimColor={!late}>{`○ ${nextLook(state.nextAt, now, zone)}`}</Text>
          ) : null}
        </Box>
        <Box paddingLeft={3}>
          <Text dimColor>{facts.join(' · ')}</Text>
        </Box>
        {(state.log ?? []).map((event) => {
          const view = eventView(event, zone);
          return (
            <Box paddingLeft={3} gap={1}>
              <Text dimColor>{clockIn(event.at, zone)}</Text>
              <Text color={view.color} dimColor={!view.color}>{view.mark}</Text>
              <Text dimColor={!view.color}>{clip(view.text, width)}</Text>
            </Box>
          );
        })}
        {below}
      </Box>
    );
  });

  // A sidebar click can land after a half-written prompt; the decision runs, the prompt never reaches the model, and
  // the draft goes back in the box.
  on('prompt.submit', { text: PROPOSAL_DECISION.atEnd }, async ($, e, next) => {
    const found = e.command ? null : PROPOSAL_DECISION.inDraft(e.text);
    return found ? dropped($, await decide($, found), found.draft) : next(e);
  });
  on('prompt.submit', { text: NOTE_DECISION.atEnd }, async ($, e, next) => {
    const found = e.command ? null : NOTE_DECISION.inDraft(e.text);
    return found ? dropped($, await noteSaid($, found), found.draft) : next(e);
  });
};
