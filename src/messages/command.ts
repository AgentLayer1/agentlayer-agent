import { LAUNCHERS, redrawHome } from '@/adapters';
import { FOLDERS } from '@/config';
import { readNotes } from '@/notes/ledger';
import { NOTE_CHOICES } from '@/notes/rules';
import { decideOnNote } from '@/notes/start';
import { readProposalLedger } from '@/proposals/ledger';
import { decideProposal } from '@/proposals/start';
import type { StartContext } from '@/sessions/launch';
import { CLI_COMMAND } from '@/shared/naming';
import { flagOf } from '@/shared/utils';

const USAGE = [
  `Usage: ${CLI_COMMAND} messages <command>`,
  `  decide <${NOTE_CHOICES.join('|')}> <id> [--workspace=<id>]  Open a session on a proposal or a note (in that cmux workspace when named), put it off until morning, or drop it`
].join('\n');

/**
 * `messages …`: what the agent surfaced on its own, proposals and notes alike, decided by id whichever ledger holds it.
 * Returns the process exit code.
 */
export const runMessagesCommand = (command: string | undefined, args: readonly string[]): number => {
  const [word, id] = args.filter((arg) => !arg.startsWith('--'));
  const choice = NOTE_CHOICES.find((known) => known === word);
  if (command !== 'decide' || !choice || !id) {
    console.error(USAGE);
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
  const said = readProposalLedger().proposals.some((proposal) => proposal.id === id)
    ? decideProposal(id, choice === 'dismiss' ? 'skip' : choice, context)
    : readNotes().notes.some((note) => note.id === id)
      ? decideOnNote(id, choice, context)
      : `Nothing waits with the id ${id}.`;
  console.log(said);
  redrawHome(FOLDERS.HOME);
  return 0;
};
