import { LAUNCHERS, redrawHome } from '@/adapters';
import { FOLDERS } from '@/config';
import { CLI_COMMAND } from '@/shared/naming';
import { flagOf } from '@/shared/utils';
import { ledgerProblem, readProposalLedger } from './ledger';
import { roomFor, showingNow, TARGET } from './rules';
import { CHOICES } from './shown';
import { decideProposal } from './start';

const USAGE = [
  `Usage: ${CLI_COMMAND} proposals <command>`,
  `  list [--json]                                   What's showing and the room for more`,
  `  decide <${CHOICES.join('|')}> <id> [--workspace=<id>]  Start (in that workspace), put off until morning, or drop`
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
  const words = args.filter((arg) => !arg.startsWith('--'));
  if (command === 'list') {
    return list(args);
  }
  const choice = CHOICES.find((known) => known === words[0]);
  const id = words[1];
  if (command === 'decide' && choice && id) {
    const workspace = flagOf(args, 'workspace');
    const context = { home: FOLDERS.HOME, adapters: LAUNCHERS, env: process.env, now: new Date(), ...(workspace ? { workspace } : {}) };
    console.log(decideProposal(id, choice, context));
    redrawHome(FOLDERS.HOME);
    return 0;
  }
  console.error(USAGE);
  return 1;
};
