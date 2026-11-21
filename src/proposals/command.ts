import { ADAPTERS } from '@/adapters';
import { FOLDERS, TIMEZONE } from '@/config';
import { readCadence } from '@/shared/cadence';
import { CLI_COMMAND } from '@/shared/naming';
import { ledgerProblem, readProposalLedger, writeProposalLedger } from './ledger';
import {
  clearHeartbeat,
  DEFAULT_EVERY_MINUTES,
  lastRefreshed,
  parseEvery,
  refreshDue,
  releaseHeartbeat,
  roomFor,
  setHeartbeat,
  TARGET,
  showingNow
} from './rules';
import { CHOICES } from './shown';
import { decideProposal, publishTo } from './start';

const USAGE = [
  `Usage: ${CLI_COMMAND} proposals <command>`,
  `  list [--json]                                   What's showing, the room for more, and the heartbeat`,
  `  decide <${CHOICES.join('|')}> <id> [--workspace=<id>]  Start (in that workspace), put off until morning, or drop`,
  `  heartbeat --owner=<token> [--every=<duration>]  Make that session the heartbeat (every 55m unless set)`,
  `  heartbeat --release --owner=<token>             End that session's heartbeat, if it still holds it`,
  `  heartbeat --off                                 No heartbeat`
].join('\n');

const flagOf = (args: readonly string[], name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const publish = (): void => publishTo(ADAPTERS, FOLDERS.HOME);

// An unreadable ledger fails the list, so the heartbeat's tick skips and keeps its clock instead of seeing no heartbeat.
const list = (args: readonly string[]): number => {
  const problem = ledgerProblem();
  if (problem) {
    console.error(problem);
    return 1;
  }
  const ledger = readProposalLedger();
  const now = new Date();
  const showing = showingNow(ledger, now);
  const room = roomFor(ledger, now);
  if (args.includes('--json')) {
    const cadence = readCadence();
    const refreshedAt = lastRefreshed(cadence.sync, cadence['brain-refresh']);
    const brain = { refreshedAt, refreshDue: refreshDue(refreshedAt, now) };
    console.log(JSON.stringify({ target: TARGET, room, showing, heartbeat: ledger.heartbeat, timezone: TIMEZONE, ...brain }));
    return 0;
  }
  const lines = showing.map(({ id, title, estimate }) => `${id}  ${title}${estimate ? ` (${estimate})` : ''}`);
  const beat = ledger.heartbeat ? `every ${ledger.heartbeat.everyMinutes}m` : 'off';
  console.log([`${showing.length} of ${TARGET} showing · room for ${room} · heartbeat ${beat}`, ...lines].join('\n'));
  return 0;
};

const heartbeat = (args: readonly string[]): number => {
  if (args.includes('--off')) {
    writeProposalLedger(clearHeartbeat(readProposalLedger()));
    publish();
    console.log('No heartbeat now.');
    return 0;
  }
  const owner = flagOf(args, 'owner');
  const every = flagOf(args, 'every');
  const minutes = every ? parseEvery(every) : DEFAULT_EVERY_MINUTES;
  if (!owner || minutes instanceof Error) {
    console.error(minutes instanceof Error ? minutes.message : USAGE);
    return 1;
  }
  const ledger = readProposalLedger();
  if (args.includes('--release')) {
    const released = releaseHeartbeat(ledger, owner);
    if (released !== ledger) {
      writeProposalLedger(released);
      publish();
    }
    return 0;
  }
  const places = ADAPTERS.map((adapter) => adapter.locate(process.env)).filter((place) => place !== null);
  const replaced = ledger.heartbeat !== null && ledger.heartbeat.owner !== owner;
  writeProposalLedger(setHeartbeat(ledger, owner, places, minutes));
  publish();
  const from = replaced ? ' It replaced an earlier heartbeat; if that session is still open, it stops at its next tick.' : '';
  const warm = minutes > 60 ? ' Over an hour apart, each wake pays to load the context again.' : '';
  console.log(`This session is the heartbeat now: it looks for proposals every ${minutes} minutes.${from}${warm}`);
  return 0;
};

/**
 * `proposals …`: the CLI over the proposals core. Returns the process exit code.
 */
export const runProposalsCommand = (command: string | undefined, args: readonly string[]): number => {
  const words = args.filter((arg) => !arg.startsWith('--'));
  if (command === 'list') {
    return list(args);
  }
  if (command === 'heartbeat') {
    return heartbeat(args);
  }
  const choice = CHOICES.find((known) => known === words[0]);
  const id = words[1];
  if (command === 'decide' && choice && id) {
    const workspace = flagOf(args, 'workspace');
    const context = { home: FOLDERS.HOME, adapters: ADAPTERS, env: process.env, now: new Date(), ...(workspace ? { workspace } : {}) };
    console.log(decideProposal(id, choice, context));
    return 0;
  }
  console.error(USAGE);
  return 1;
};
