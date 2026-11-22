import { agentDisplayName } from '@/shared/agent-name';
import { chosenAdapters, deliverNote, type NoteAdapter, type NoteContext } from './adapter';
import { readNotes, writeNotes } from './ledger';
import { addNotes, DAILY_CAP, notesOn, type NoteInput } from './rules';

export const noteContext = (): NoteContext => ({ agentName: agentDisplayName() });

interface Sent {
  added: {
    id: string;
    source: string;
    title: string;
    body: string;
    next: string;
    sources: string[];
    canStart: boolean;
    delivered: string[];
  }[];
  refused: { source: string; title: string; reason: string }[];
  cap: number;
  today: number;
}

/**
 * Adds the notes the rules allow and delivers each through every chosen adapter.
 */
export const sendNotes = async (
  inputs: readonly NoteInput[],
  adapters: readonly NoteAdapter[],
  now: Date
): Promise<Sent> => {
  const { ledger, added, refused } = addNotes(readNotes(), inputs, now);
  writeNotes(ledger);
  const context = noteContext();
  const chosen = chosenAdapters(adapters, process.env);
  const results = await Promise.all(
    added.map(async (note) => ({ note, delivered: await deliverNote(note, chosen, context) }))
  );
  return {
    added: results.map(({ note: { id, source, title, body, next, sources, prompt }, delivered }) => ({
      id,
      source,
      title,
      body,
      next,
      sources,
      canStart: prompt !== '',
      delivered
    })),
    refused,
    cap: DAILY_CAP,
    today: notesOn(ledger, now).length
  };
};
