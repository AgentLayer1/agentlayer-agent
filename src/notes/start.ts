import { startPrompt, type StartContext } from '@/sessions/launch';
import { notesProblem, readNotes, writeNotes } from './ledger';
import { decideNote, notePrompt, reopenNote, type NoteChoice } from './rules';

/**
 * Applies the operator's choice on a note and says what happened. Start marks the note started before opening anything,
 * so a repeat can't open a second session, and puts it back if the session couldn't open.
 */
export const decideOnNote = (id: string, choice: NoteChoice, context: StartContext): string => {
  const problem = notesProblem();
  if (problem) {
    return problem;
  }
  const decision = decideNote(readNotes(), id, choice, context.now);
  if (decision.outcome === 'unknown') {
    return `No note ${id}.`;
  }
  if (decision.outcome === 'already') {
    return `${decision.note.title}: already ${decision.note.reaction}.`;
  }
  const { note } = decision;
  writeNotes(decision.ledger);
  if (choice !== 'start') {
    return choice === 'later' ? `Later: ${note.title} comes back in the morning.` : `Dismissed: ${note.title}.`;
  }
  const opened = startPrompt({ id, prompt: notePrompt(note) }, context);
  if ('error' in opened) {
    writeNotes(reopenNote(readNotes(), id));
    return `Couldn't start ${note.title}: ${opened.error}`;
  }
  return `Started: ${note.title}. ${opened.where}`;
};
