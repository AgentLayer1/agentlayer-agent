import { LAUNCHERS, redrawHome } from '@/adapters';
import { FOLDERS } from '@/config';
import { noteMessages } from '@/notes/kind';
import { proposalMessages } from '@/proposals/kind';
import type { StartContext } from '@/sessions/launch';
import { CLI_COMMAND } from '@/shared/naming';
import { flagOf } from '@/shared/utils';
import { MESSAGE_CHOICES } from './choices';
import { decideMessage } from './decide';

const USAGE = [
  `Usage: ${CLI_COMMAND} messages <command>`,
  `  decide <${MESSAGE_CHOICES.join('|')}> <id> [--workspace=<id>]  Open a session on a proposal or a note (in that cmux workspace when named), put it off until morning, or drop it`
].join('\n');

/**
 * `messages …`: what the agent surfaced on its own, proposals and notes alike, decided by id whichever ledger holds it.
 * Returns the process exit code.
 */
export const runMessagesCommand = (command: string | undefined, args: readonly string[]): number => {
  const [word, id] = args.filter((arg) => !arg.startsWith('--'));
  const choice = MESSAGE_CHOICES.find((known) => known === word);
  if (command !== 'decide' || !choice || !id) {
    console.error(USAGE);
    return 1;
  }
  // The lookup reads a broken ledger as empty, so it would answer "nothing waits" instead of naming the file.
  const problem = proposalMessages.problem() || noteMessages.problem();
  if (problem) {
    console.error(problem);
    return 1;
  }
  const workspace = flagOf(args, 'workspace');
  const context: StartContext = {
    home: FOLDERS.HOME,
    adapters: LAUNCHERS,
    env: process.env,
    now: new Date(),
    ...(workspace ? { workspace } : {})
  };
  const said =
    decideMessage(proposalMessages, id, choice, context) ??
    decideMessage(noteMessages, id, choice, context) ??
    `Nothing waits with the id ${id}.`;
  console.log(said);
  redrawHome(FOLDERS.HOME);
  return 0;
};
