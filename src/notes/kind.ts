import type { MessageLedger } from '@/messages/decide';
import { notesProblem, readNotes, writeNotes, type Note, type NoteLedger } from './ledger';
import { decideNote, notePrompt, reopenNote } from './rules';

export const noteMessages: MessageLedger<NoteLedger, Note> = {
  problem: notesProblem,
  read: readNotes,
  write: writeNotes,
  decide: decideNote,
  reopen: reopenNote,
  prompt: notePrompt
};
