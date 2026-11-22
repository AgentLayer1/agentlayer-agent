import { CLI_COMMAND } from '@/shared/naming';
import { ledgerProblem, readProposalLedger } from './ledger';
import { roomFor, showingNow, TARGET } from './rules';

const USAGE = [
  `Usage: ${CLI_COMMAND} proposals <command>`,
  `  list [--json]   What's showing and the room for more (decide one with messages decide)`
].join('\n');

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
    console.log(JSON.stringify({ target: TARGET, room, showing }));
    return 0;
  }
  const lines = showing.map(({ id, title, estimate }) => `${id}  ${title}${estimate ? ` (${estimate})` : ''}`);
  console.log([`${showing.length} of ${TARGET} showing · room for ${room}`, ...lines].join('\n'));
  return 0;
};
/**
 * `proposals …`: the CLI over the proposals core. Returns the process exit code.
 */
export const runProposalsCommand = (command: string | undefined, args: readonly string[]): number => {
  if (command === 'list') {
    return list(args);
  }
  console.error(USAGE);
  return 1;
};
