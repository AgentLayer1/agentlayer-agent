import { atom, read, update } from 'claude-code';
import type { EngineInterface, On } from 'claude-code';

import { HEARTBEAT_FEATURE } from '../shared/catalog';
import { cliArgv, cliError, errorText } from '../shared/cli';
import { expandHome } from '../manuals/repo';
import { TURN_REASONS } from '../shared/turns';
import { clip } from '../tasks/task';
import type { HeartbeatEvent, Queue } from '../types';
import { SCOUTING_AGENTS, homeLensAgent, scoutAgent } from './agents';
import {
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
  nextLookCron,
  noticeText,
  notesSent,
  parseAsk,
  parseStatus,
  proposalsChanged,
  workspaceTitles,
  MESSAGE_CHOICES,
  MESSAGE_AT_END,
  decisionInDraft,
  homeLensTools,
  notesHint,
  scoutTools,
  carriesEmail,
  carriesPrivateName,
  ENGINE_TOOLS,
  privateNames,
  parseBrief,
  parseDecision,
  type Decision,
  type HeartbeatStatus,
  type NotesBrief
} from './beat';

const USAGE = `Usage: /message <${MESSAGE_CHOICES.join('|')}> <id> [--workspace=<id>]`;
// Inside the engine's short bound on every session.end hook.
const RELEASE_TIMEOUT_MS = 1000;
// TODO(windows): cmux is a macOS app, found only in /Applications.
const CMUX_BIN = '/Applications/cmux.app/Contents/Resources/bin/cmux';
const CMUX_TIMEOUT_MS = 5000;
// A scout still running this long after it started is given up on; any report it sends later is still kept out.
const SCOUT_TIMEOUT_MS = 20 * MINUTE_MS;
const OWN_TOOLS_ONLY = 'A scouting agent runs its own tools only.';
const NO_EMAIL = "The scout's searches and fetches never carry an email address.";
const NO_PRIVATE_NAME = "The scout's searches and fetches never carry a name from the operator's private folders.";
const SCOUT_REFUSED = "Only the heartbeat starts its scouting agents, on a brief its code writes; a prompt a model wrote could carry the home's private facts to the web.";
const SCOUT_REPORT_KEPT = "A scouting agent's notes are in the notes list; its report stays out of this conversation.";

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
  await giveUpOnScout($);
  await revive($);
}

// A scout that outlives its time is no longer waited on; a report it sends later is still kept out.
async function giveUpOnScout($: EngineInterface): Promise<void> {
  const [{ scouting }, now] = await Promise.all([read($, beat), $.clock.now()]);
  if (!scouting || now - scouting.since < SCOUT_TIMEOUT_MS) {
    return;
  }
  await update($, beat, (current) => ({ ...current, scouting: undefined }));
  await note($, { at: now, kind: 'stopped', text: `the scout didn't finish in ${SCOUT_TIMEOUT_MS / MINUTE_MS}m` });
}

// Several callers can find the clock stopped in the same moment; only the first restarts it and looks.
let reviving = false;

async function revive($: EngineInterface): Promise<void> {
  if (reviving) {
    return;
  }
  reviving = true;
  try {
    const { isHeartbeat, nextAt, everyMinutes, zone = 'UTC' } = await read($, beat);
    const now = await $.clock.now();
    if (!isHeartbeat || nextAt === undefined || everyMinutes === undefined || now - nextAt <= STALL_MS) {
      return;
    }
    logLate($, nextAt, now, 'revived');
    startLooks($, everyMinutes);
    await update($, beat, (current) => ({ ...current, nextAt: now + everyMinutes * MINUTE_MS }));
    await note($, { at: now, kind: 'stopped', text: `the look due ${clockIn(nextAt, zone)} never came; the clock restarted` });
    await tick($);
  } finally {
    reviving = false;
  }
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
  return runCli($, args).then((stdout) => stdout.trim(), errorText);
}

// The band's notes die with this process, and the CLI logs every call with its arguments, so a late start goes
// through it: a look cut short by sleep can then be traced to one that began late.
function logLate($: EngineInterface, dueAt: number, now: number, how: 'tick' | 'revived'): void {
  void said($, ['heartbeat', 'status', `--late=${Math.round((now - dueAt) / MINUTE_MS)}m`, `--${how}`]);
}

async function statusOrWhy($: EngineInterface): Promise<HeartbeatStatus | string> {
  return runCli($, ['heartbeat', 'status', '--json']).then(
    (stdout) => parseStatus(stdout) ?? "the heartbeat's status didn't read",
    errorText
  );
}

async function readStatus($: EngineInterface): Promise<HeartbeatStatus | null> {
  const status = await statusOrWhy($);
  return typeof status === 'string' ? null : status;
}

// A message is a proposal or a note; the CLI finds which by its id.
async function decide($: EngineInterface, { choice, id, workspace }: Decision): Promise<string> {
  return said($, ['messages', 'decide', choice, id, ...(workspace ? [`--workspace=${workspace}`] : [])]);
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
async function wake(
  $: EngineInterface,
  now: number,
  status: HeartbeatStatus,
  refresh = false,
  isRetry = false
): Promise<void> {
  const today = dayIn(now, status.timezone);
  const { wokeOn } = await read($, beat);
  const clears = refresh || (wokeOn !== '' && wokeOn !== today);
  if (clears) {
    const clearedId = await $.session.id();
    await update($, beat, (current) => ({ ...current, clearedId, awaiting: [] }));
    await $.command.run({ command: 'clear' });
  }
  // A refresh is tried once per window and retried once, so one that fails before it stamps doesn't run on every tick.
  await update($, beat, (current) => ({
    ...current,
    wokeOn: today,
    ...(refresh ? { refreshTriedAt: now, refreshRetried: isRetry } : {})
  }));
  $.clock.after(0, async () => {
    if (refresh) {
      await expectTurn($, 'refresh');
      await $.command.run({ command: `${$.plugin.name}:sync`, args: 'brain' });
      await scout($, status);
    }
    await look($);
  });
}

const isScoutingType = ($: EngineInterface, type: string): boolean =>
  Object.keys(SCOUTING_AGENTS).some((name) => type === `${$.plugin.name}:${name}`);

// Scouting for notes rides on the refresh while the day has room, through the lens the code picks, in the agent the
// brief names: the scout for a web lens, the home lens otherwise. Neither runs in this conversation, so nothing it reads
// needs a /clear before the look.
async function scout($: EngineInterface, status: HeartbeatStatus): Promise<void> {
  // One at a time: a second would take the first's place in every guard below.
  if (!status.notes.scout || !status.notes.room || (await read($, beat)).scouting) {
    return;
  }
  const titles = await workspacesNow($);
  const brief = await runCli($, ['notes', 'brief', '--json', `--workspaces=${JSON.stringify(titles)}`]).then(
    parseBrief,
    () => null
  );
  if (!brief) {
    await note($, { at: await $.clock.now(), kind: 'skip', text: "the notes brief didn't read" });
    return;
  }
  await update($, beat, (current) => ({ ...current, notesThisWake: 0 }));
  await sendScout($, brief);
}

// The agent's prompt is the brief the code wrote, whole: no model chose a word of it. Its id is how every guard below
// knows its loop.
// The folders the engine lists in every agent's context: the session's root and the directories it was granted.
async function workingFolders($: EngineInterface): Promise<string[]> {
  const [root, home, settings] = await Promise.all([$.session.root(), $.env.get('HOME'), $.settings.read()]);
  const permissions: unknown = settings.permissions;
  const granted =
    typeof permissions === 'object' && permissions !== null && 'additionalDirectories' in permissions
      ? permissions.additionalDirectories
      : [];
  const listed = (Array.isArray(granted) ? granted : []).filter((entry): entry is string => typeof entry === 'string');
  return [root, ...listed.map((entry) => expandHome(entry, home))];
}

async function sendScout($: EngineInterface, { agent, prompt }: NotesBrief): Promise<void> {
  const since = await $.clock.now();
  // Worked out before the spawn, so the scout's first tool check already has them.
  const names = agent === 'scout' ? privateNames(await workingFolders($).catch(() => []), prompt) : [];
  const started = await $.agent
    .spawn({ prompt, subagentType: `${$.plugin.name}:${agent}`, description: SCOUTING_AGENTS[agent] })
    .catch((error: unknown) => ({ deny: errorText(error) }));
  if (started.deny === undefined && started.agentId) {
    const id = started.agentId;
    // Recorded before anything else awaits, so the agent's first tool check finds it.
    await update($, beat, (current) => ({ ...current, scouting: { id, since, agent, privateNames: names } }));
    return;
  }
  const why = started.deny ? `: ${started.deny}` : '';
  await note($, { at: await $.clock.now(), kind: 'stopped', text: `the scout didn't start${why}` });
}

const isScoutLoop = (state: { scouting?: { id: string } }, agentId: string | undefined): boolean =>
  agentId !== undefined && state.scouting?.id === agentId;

async function markChanged($: EngineInterface): Promise<void> {
  await update($, beat, (current) => (current.isHeartbeat && current.awaiting?.length ? { ...current, wakeChanged: true } : current));
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

// The heartbeat is this running process, named by a token it picks once. Session state starts empty after a /clear,
// which is a new conversation, so the process keeps its own copy; session state keeps one through a reload of this module.
let processToken = '';

async function heldToken($: EngineInterface): Promise<string> {
  const { owner } = await read($, beat);
  if (owner) {
    processToken = owner;
    return owner;
  }
  if (processToken) {
    const token = processToken;
    await update($, beat, (current) => ({ ...current, owner: token }));
  }
  return processToken;
}

async function ownerOf($: EngineInterface): Promise<string> {
  const held = await heldToken($);
  if (held) {
    return held;
  }
  const [sessionId, now] = await Promise.all([$.session.id(), $.clock.now()]);
  const token = `${sessionId}@${now.toString(36)}`;
  processToken = token;
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
  const [{ nextAt: dueAt }, startedAt] = await Promise.all([read($, beat), $.clock.now()]);
  if (dueAt !== undefined && isLate(dueAt, startedAt)) {
    logLate($, dueAt, startedAt, 'tick');
  }
  const [status, { isBusy }, { everyMinutes = 55 }, owner] = await Promise.all([
    statusOrWhy($),
    read($, queue),
    read($, beat),
    heldToken($)
  ]);
  if (typeof status === 'string') {
    // A status that won't read is a skip with its reason, and the next look keeps its interval.
    const now = await $.clock.now();
    await update($, beat, (current) => ({ ...current, nextAt: now + everyMinutes * MINUTE_MS }));
    await note($, { at: now, kind: 'skip', text: status });
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
  const { refreshTriedAt = 0, refreshRetried = false } = await read($, beat);
  // A refresh waits for something to absorb: a session written since the last sync or refresh.
  const absorbs = used === null || used > refreshedMs(status);
  const windowPassed = now - refreshTriedAt >= REFRESH_RETRY_MS;
  // A try newer than the last recorded refresh never finished, as when the machine slept through it.
  const isRetry = !windowPassed && refreshTriedAt > refreshedMs(status) && !refreshRetried;
  if (status.refreshDue && absorbs && (windowPassed || isRetry)) {
    await ticked($, status, now);
    await wake($, now, status, true, isRetry);
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
  const owner = await heldToken($);
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
  const [status, now, { nextAt }, owner, used] = await Promise.all([
    readStatus($),
    $.clock.now(),
    read($, beat),
    heldToken($),
    lastUse($)
  ]);
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
  return `${who} is the heartbeat, every ${status.heartbeat.everyMinutes}m, skipping a wake when no other session in the home was active in that time (${activity}). ${showing}.${next}${notesHint($.plugin.name, status.notes)}`;
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
    const [status, owner] = await Promise.all([readStatus($), heldToken($)]);
    if (isOwner(status, owner) && status.refreshDue) {
      const now = await $.clock.now();
      $.clock.after(0, () => void wake($, now, status, true));
      return 'Refreshing the brain, then looking for proposals.';
    }
    $.clock.after(0, () => void look($));
    return 'Looking for proposals now.';
  }
  if (ask.kind === 'scout') {
    // The same run a brain refresh ends with, asked for now: in the heartbeat's tab, where a home lens's clear belongs.
    const [status, owner, { scouting }] = await Promise.all([readStatus($), heldToken($), read($, beat)]);
    if (!isOwner(status, owner)) {
      return "Scouting runs in the heartbeat's own tab: run /heartbeat scout there.";
    }
    if (!status.notes.scout) {
      return 'Scouting is off: configure-skills → Notes approves the public facts and turns it on.';
    }
    if (!status.notes.room) {
      return 'No room for notes today.';
    }
    if (scouting) {
      return 'A scout is already out; the band says when it ends.';
    }
    $.clock.after(0, () => void scout($, status));
    return "Scouting now, through the lens whose turn it is; the band says how it went.";
  }
  if (ask.kind === 'off') {
    const text = await said($, ['heartbeat', 'off']);
    await arm($);
    return text;
  }
  // A bare /heartbeat in the tab that already is the heartbeat (a menu pick, an argument lost) changes nothing; only an
  // interval rebinds it.
  if (!ask.every) {
    const [status, owner] = await Promise.all([readStatus($), heldToken($)]);
    if (isOwner(status, owner)) {
      return describe($);
    }
  }
  const every = ask.every ? [`--every=${ask.every}`] : [];
  const text = await said($, ['heartbeat', 'bind', `--owner=${await ownerOf($)}`, ...every]);
  const bound = await arm($);
  return `${text}${bound ? notesHint($.plugin.name, bound.notes) : ''}${await firstLook($, bound)}`;
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
    // An agent that couldn't be registered fails to spawn, and the band says so; nothing else depends on it.
    await Promise.all(
      [scoutAgent($.plugin.name), homeLensAgent($.plugin.name)].map((agent) => $.agent.register(agent).catch(() => undefined))
    );
    $.clock.after(0, () => void arm($));
    return next(e);
  });

  // A /clear or a /resume keeps this process, and with it the heartbeat; only leaving it gives the heartbeat up. A crash
  // runs no hook, which is why a later /heartbeat still says it replaced one.
  on('session.end', { reason: ['prompt_input_exit', 'logout', 'other'] }, async ($, e, next) => {
    const owner = await heldToken($);
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

  on('command.run', { command: 'message' }, async ($, e) => {
    const decision = parseDecision(e.args);
    return { text: decision ? await decide($, decision) : USAGE };
  });

  on('command.run', { command: 'heartbeat' }, async ($, e) => ({ text: await heartbeat($, e.args) }));

  on('tool.call', { tool: /__proposal_add$/ }, async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined && proposalsChanged(result.text ?? '')) {
      await markChanged($);
    }
    return result;
  });

  // A wake that changed nothing names the next look as a pending wakeup in its Stop, so cmux holds its turn-done
  // notification and its "waiting for input" reminder; one that changed something ends as any turn does.
  on('classic.Stop', async ($, e, next) => {
    const { isHeartbeat, awaiting = [], wakeChanged, nextAt, zone = 'UTC' } = await read($, beat);
    if (!isHeartbeat || !awaiting.length) {
      return next(e);
    }
    await update($, beat, (current) => ({ ...current, wakeChanged: false }));
    if (wakeChanged || nextAt === undefined) {
      return next(e);
    }
    return next({ ...e, session_crons: [...(e.session_crons ?? []), nextLookCron(nextAt, zone)] });
  }).catch(($, e, next) => next(e));

  // A note the session sends lands in its scrollback as a notice the model never reads; the heartbeat's band counts it.
  on('tool.call', { tool: /__note_add$/ }, async ($, e, next) => {
    const result = await next(e);
    const sent = notesSent(result.text ?? '');
    if (sent?.notes.length) {
      if (e.agentId === undefined) {
        await markChanged($);
      }
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

  // No model starts a scouting agent. The heartbeat's own spawn never runs this plugin's hooks, so it alone gets past the
  // refusal; hiding the types from the listing only saves a model the try.
  on('agent.spawn', { subagentType: /:(scout|home-lens)$/ }, async ($, e, next) =>
    isScoutingType($, e.subagentType) ? { deny: SCOUT_REFUSED } : next(e)
  ).catch(($, e, next) => (next.called ? next(e) : { deny: SCOUT_REFUSED }));

  on('agent.offer', { agent: /:(scout|home-lens)$/ }, async ($, e, next) =>
    isScoutingType($, e.agent) ? { isOffered: false } : next(e)
  ).catch(($, e, next) => (next.called ? next(e) : { isOffered: false }));

  // What a scouting agent read never reaches a conversation; its notes are in the list, and its line is the band's.
  on('agent.report', async ($, e, next) =>
    isScoutingType($, e.subagentType) ? { consumed: SCOUT_REPORT_KEPT } : next(e)
  ).catch(($, e, next) =>
    next.called || !isScoutingType($, e.subagentType) ? next(e) : { consumed: SCOUT_REPORT_KEPT }
  );

  // A scouting agent runs unattended, so its own tools need no one's yes, and anything else is refused behind its tool
  // list. A failure here leaves the call to the engine's own check.
  on('tool.check', async ($, e, next) => {
    const state = e.agentId === undefined ? null : await read($, beat);
    const scouting = state && isScoutLoop(state, e.agentId) ? state.scouting : undefined;
    if (!scouting) {
      return next(e);
    }
    const tools = scouting.agent === 'scout' ? scoutTools($.plugin.name) : homeLensTools($.plugin.name);
    if (![...tools, ...ENGINE_TOOLS].includes(String(e.tool))) {
      return { decision: 'deny', reason: OWN_TOOLS_ONLY };
    }
    if (scouting.agent === 'scout' && carriesEmail(e.input)) {
      return { decision: 'deny', reason: NO_EMAIL };
    }
    if (scouting.agent === 'scout' && carriesPrivateName(e.input, scouting.privateNames ?? [])) {
      return { decision: 'deny', reason: NO_PRIVATE_NAME };
    }
    return { decision: 'allow' };
  }).catch(($, e, next) => next(e));

  // A wake's turn ends on the skill's one-line ending, which is what the band says it did; the scout's ends its run.
  on('turn.complete', { reason: TURN_REASONS }, async ($, e, next) => {
    const state = await read($, beat);
    const { awaiting = [], notesThisWake = 0 } = state;
    if (isScoutLoop(state, e.agentId)) {
      const now = await $.clock.now();
      await update($, beat, (current) => ({ ...current, scouting: undefined }));
      await note(
        $,
        e.reason === 'answer'
          ? { at: now, kind: 'notes', text: closingLine(e.answer) || 'done', sent: notesThisWake }
          : { at: now, kind: 'stopped', text: `the scout stopped (${e.reason})` }
      );
      return next(e);
    }
    const kind = awaiting[0];
    if (e.agentId === undefined && kind) {
      const now = await $.clock.now();
      const done = kind === 'refresh' ? kind : 'look';
      await update($, beat, (current) => ({ ...current, awaiting: (current.awaiting ?? []).slice(1), workingSince: now }));
      const last = awaiting.length === 1;
      await note(
        $,
        e.reason === 'answer'
          ? { at: now, kind: done, text: closingLine(e.answer) || 'done' }
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
          ) : state.scouting ? (
            <Text color="magenta">{`◉ scouting ${state.scouting.agent === 'scout' ? 'the web' : 'the home'}… since ${clockIn(state.scouting.since, zone)}`}</Text>
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
  on('prompt.submit', { text: MESSAGE_AT_END }, async ($, e, next) => {
    const found = e.command ? null : decisionInDraft(e.text);
    return found ? dropped($, await decide($, found), found.draft) : next(e);
  });
};
