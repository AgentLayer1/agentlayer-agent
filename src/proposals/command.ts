import { ADAPTERS } from '@/adapters';
import { FOLDERS, TIMEZONE } from '@/config';
import { CLI_COMMAND } from '@/shared/naming';
import { ledgerProblem, readProposalLedger, writeProposalLedger } from './ledger';
import {
  CHOICES,
  clearHeartbeat,
  DEFAULT_EVERY_MINUTES,
  parseEvery,
  roomFor,
  setHeartbeat,
  TARGET,
  showingNow
} from './rules';
import { decideProposal, publishTo } from './start';

const USAGE = [
  `Usage: ${CLI_COMMAND} proposals <command>`,
  `  list [--json]                                   What's showing, the room for more, and the heartbeat`,
  `  decide <${CHOICES.join('|')}> <id>                    Start, put off until morning, or drop a proposal`,
  `  heartbeat --owner=<token> [--every=<duration>]  Make that session the heartbeat (every 55m unless set)`,
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
    console.log(JSON.stringify({ target: TARGET, room, showing, heartbeat: ledger.heartbeat, timezone: TIMEZONE }));
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
  const places = ADAPTERS.map((adapter) => adapter.locate(process.env)).filter((place) => place !== null);
  writeProposalLedger(setHeartbeat(readProposalLedger(), owner, places, minutes));
  publish();
  const warm = minutes > 60 ? ' Over an hour apart, each wake pays to load the context again.' : '';
  console.log(`This session is the heartbeat now: it looks for proposals every ${minutes} minutes.${warm}`);
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
    const context = { home: FOLDERS.HOME, adapters: ADAPTERS, env: process.env, now: new Date() };
    console.log(decideProposal(id, choice, context));
    return 0;
  }
  console.error(USAGE);
  return 1;
};
