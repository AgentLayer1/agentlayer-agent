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

const beat = atom({ plugin: 'agentlayer', key: 'heartbeat' } as const, { wokeOn: '' });
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

// The day's first wake clears the conversation first, so the heartbeat's context doesn't grow without end. A clear
// starts a new conversation with a new session id, so the heartbeat binds itself to that id at the same interval.
async function wake($: EngineInterface, everyMinutes: number | null): Promise<void> {
  const [now, zone] = await Promise.all([$.clock.now(), zoneOf($)]);
  const today = dayIn(now, zone);
  const { wokeOn } = await read($, beat);
  if (wokeOn && wokeOn !== today) {
    await $.command.run({ command: 'clear' });
    if (everyMinutes !== null) {
      await said($, ['proposals', 'heartbeat', `--session=${await $.session.id()}`, `--every=${everyMinutes}m`]);
    }
  }
  await update($, beat, (current) => ({ ...current, wokeOn: today }));
  $.clock.after(0, () => void $.command.run({ command: `${$.plugin.name}:heartbeat` }));
}

// Free unless every gate passes: this session is the heartbeat, no turn runs, it isn't quiet, and room is left.
async function tick($: EngineInterface): Promise<void> {
  const [list, sessionId, { isBusy }] = await Promise.all([readList($), $.session.id(), read($, queue)]);
  if (!list) {
    return;
  }
  if (list.heartbeat?.sessionId !== sessionId) {
    ticker?.cancel();
    ticker = undefined;
    return;
  }
  const [now, zone] = await Promise.all([$.clock.now(), zoneOf($)]);
  if (!list.heartbeat || isBusy || isQuiet(now, zone) || list.waiting.length >= list.target) {
    return;
  }
  await wake($, list.heartbeat.everyMinutes);
}

async function arm($: EngineInterface): Promise<void> {
  const [list, sessionId] = await Promise.all([readList($), $.session.id()]);
  ticker?.cancel();
  ticker = undefined;
  if (list?.heartbeat && list.heartbeat.sessionId === sessionId) {
    ticker = $.clock.every(list.heartbeat.everyMinutes * MINUTE_MS, () => void tick($));
  }
}

async function status($: EngineInterface): Promise<string> {
  const [list, sessionId, now, zone] = await Promise.all([readList($), $.session.id(), $.clock.now(), zoneOf($)]);
  if (!list) {
    return "Couldn't read the proposals.";
  }
  const waiting = `${list.waiting.length} of ${list.target} proposals waiting`;
  if (!list.heartbeat) {
    return `No heartbeat. ${waiting}. /heartbeat makes this session the one.`;
  }
  const who = list.heartbeat.sessionId === sessionId ? 'This session' : 'Another session';
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
    const list = await readList($);
    const sessionId = await $.session.id();
    const every = list?.heartbeat?.sessionId === sessionId ? list.heartbeat.everyMinutes : null;
    $.clock.after(0, () => void wake($, every));
    return 'Looking for proposals now.';
  }
  const cli =
    ask.kind === 'off'
      ? ['proposals', 'heartbeat', '--off']
      : [
          'proposals',
          'heartbeat',
          `--session=${await $.session.id()}`,
          ...(ask.every ? [`--every=${ask.every}`] : [])
        ];
  const text = await said($, cli);
  await arm($);
  return text;
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
