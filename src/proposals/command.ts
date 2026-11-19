import { ADAPTERS } from '@/adapters';
import { FOLDERS } from '@/config';
import { CLI_COMMAND } from '@/shared/naming';
import { readProposalLedger, writeProposalLedger } from './ledger';
import {
  CHOICES,
  clearHeartbeat,
  DEFAULT_EVERY_MINUTES,
  parseEvery,
  removeProposals,
  roomFor,
  setHeartbeat,
  TARGET,
  waitingNow
} from './rules';
import { decideProposal, publishTo } from './start';

const USAGE = [
  `Usage: ${CLI_COMMAND} proposals <command>`,
  `  list [--json]                                   What's waiting, and the heartbeat`,
  `  decide <${CHOICES.join('|')}> <id>                    Start, put off until morning, or drop a proposal`,
  `  remove <id>…                                    Take proposals out`,
  `  heartbeat --owner=<token> [--every=<duration>]  Make that session the heartbeat (every 55m unless set)`,
  `  heartbeat --off                                 No heartbeat`
].join('\n');

const flagOf = (args: readonly string[], name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const publish = (): void => publishTo(ADAPTERS, FOLDERS.HOME);

const list = (args: readonly string[]): number => {
  const ledger = readProposalLedger();
  const now = new Date();
  const waiting = waitingNow(ledger, now);
  const room = roomFor(ledger, now);
  if (args.includes('--json')) {
    console.log(JSON.stringify({ target: TARGET, room, waiting, heartbeat: ledger.heartbeat }));
    return 0;
  }
  const lines = waiting.map(({ id, title, estimate }) => `${id}  ${title}${estimate ? ` (${estimate})` : ''}`);
  const beat = ledger.heartbeat ? `every ${ledger.heartbeat.everyMinutes}m` : 'off';
  console.log([`${waiting.length} of ${TARGET} waiting · room for ${room} · heartbeat ${beat}`, ...lines].join('\n'));
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
  if (command === 'remove' && words.length) {
    writeProposalLedger(removeProposals(readProposalLedger(), words));
    publish();
    console.log(`Removed ${words.join(', ')}.`);
    return 0;
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
