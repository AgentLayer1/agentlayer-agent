import { LAUNCHERS, redrawHome } from '@/adapters';
import { FOLDERS, TIMEZONE } from '@/config';
import { notesProblem, readNotes } from '@/notes/ledger';
import { DAILY_CAP, notesOn, roomToday } from '@/notes/rules';
import { ledgerProblem, readProposalLedger } from '@/proposals/ledger';
import { roomFor, showingNow, TARGET } from '@/proposals/rules';
import { readCadence } from '@/shared/cadence';
import { env } from '@/shared/env';
import { CLI_COMMAND } from '@/shared/naming';
import { flagOf } from '@/shared/utils';
import { heartbeatProblem, readHeartbeat, writeHeartbeat } from './ledger';
import { DEFAULT_EVERY_MINUTES, lastRefreshed, parseEvery, refreshDue, released } from './rules';

const USAGE = [
  `Usage: ${CLI_COMMAND} heartbeat <command>`,
  `  status [--json]                            Who the heartbeat is, the brain's last refresh, and the room for proposals and notes`,
  `  bind --owner=<token> [--every=<duration>]  Make that session the heartbeat (every 55m unless set)`,
  `  release --owner=<token>                    End that session's heartbeat, if it still holds it`,
  `  off                                        No heartbeat`
].join('\n');

const publish = (): void => redrawHome(FOLDERS.HOME);

// An unreadable record fails the status, so the heartbeat's tick skips and keeps its clock instead of seeing none.
const status = (args: readonly string[]): number => {
  const problem = heartbeatProblem() || ledgerProblem();
  if (problem) {
    console.error(problem);
    return 1;
  }
  const beat = readHeartbeat();
  const now = new Date();
  const proposals = readProposalLedger();
  const notes = readNotes();
  const cadence = readCadence();
  const refreshedAt = lastRefreshed(cadence.sync, cadence['brain-refresh']);
  const view = {
    heartbeat: beat,
    timezone: TIMEZONE,
    refreshedAt,
    refreshDue: refreshDue(refreshedAt, now),
    proposals: { target: TARGET, room: roomFor(proposals, now), showing: showingNow(proposals, now).length },
    notes: {
      cap: DAILY_CAP,
      today: notesOn(notes, now).length,
      room: notesProblem() ? 0 : roomToday(notes, now),
      scout: env('AGENT_NOTES_SCOUT') !== 'off'
    }
  };
  if (args.includes('--json')) {
    console.log(JSON.stringify(view));
    return 0;
  }
  const facts = [
    beat ? `Heartbeat every ${beat.everyMinutes}m` : 'No heartbeat',
    `${view.proposals.showing} of ${view.proposals.target} proposals showing`,
    view.notes.scout ? `${view.notes.today} of ${view.notes.cap} notes today` : 'scouting off',
    refreshedAt ? `brain refreshed ${refreshedAt}` : 'brain never refreshed'
  ];
  console.log(facts.join(' · '));
  return 0;
};

const bind = (args: readonly string[]): number => {
  const owner = flagOf(args, 'owner');
  const every = flagOf(args, 'every');
  const minutes = every ? parseEvery(every) : DEFAULT_EVERY_MINUTES;
  if (!owner || minutes instanceof Error) {
    console.error(minutes instanceof Error ? minutes.message : USAGE);
    return 1;
  }
  const before = readHeartbeat();
  const places = LAUNCHERS.map((launcher) => launcher.locate(process.env)).filter((place) => place !== null);
  writeHeartbeat({ owner, places, everyMinutes: minutes });
  publish();
  const from =
    before && before.owner !== owner
      ? ' It replaced an earlier heartbeat; if that session is still open, it stops at its next tick.'
      : '';
  const warm = minutes > 60 ? ' Over an hour apart, each wake pays to load the context again.' : '';
  console.log(`This session is the heartbeat now: it looks for proposals every ${minutes} minutes.${from}${warm}`);
  return 0;
};

const release = (args: readonly string[]): number => {
  const owner = flagOf(args, 'owner');
  if (!owner) {
    console.error(USAGE);
    return 1;
  }
  const before = readHeartbeat();
  const after = released(before, owner);
  if (after !== before) {
    writeHeartbeat(after);
    publish();
  }
  return 0;
};

/**
 * `heartbeat …`: the CLI over the session that keeps the home's work coming. Returns the process exit code.
 */
export const runHeartbeatCommand = (command: string | undefined, args: readonly string[]): number => {
  if (command === 'status') {
    return status(args);
  }
  if (command === 'bind') {
    return bind(args);
  }
  if (command === 'release') {
    return release(args);
  }
  if (command === 'off') {
    readHeartbeat();
    writeHeartbeat(null);
    publish();
    console.log('No heartbeat now.');
    return 0;
  }
  console.error(USAGE);
  return 1;
};
