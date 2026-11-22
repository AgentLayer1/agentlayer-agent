import type { MessageKind } from '@/messages/decide';
import { notesProblem, readNotes, writeNotes, type Note, type NoteLedger } from './ledger';
import { decideNote, notePrompt, reopenNote } from './rules';

export const noteMessages: MessageKind<NoteLedger, Note> = {
  noun: 'note',
  problem: notesProblem,
  read: readNotes,
  write: writeNotes,
  has: (ledger, id) => ledger.notes.some((note) => note.id === id),
  decide: decideNote,
  reopen: reopenNote,
  prompt: notePrompt
};
