import { FOLDERS } from '@/config';
import { readProposalLedger } from '@/proposals/ledger';
import { agentDisplayName } from '@/shared/agent-name';
import { chosenAdapters, deliverNote, publishNotes, type NoteAdapter, type NoteContext } from './adapter';
import { notesProblem, readNotes, writeNotes, type Note } from './ledger';
import { addNotes, delivered, roomToday, type NoteInput } from './rules';

export const noteContext = (now: Date): NoteContext => ({
  home: FOLDERS.HOME,
  agentName: agentDisplayName(),
  env: process.env,
  now,
  heartbeat: readProposalLedger().heartbeat?.places[0] ?? null
});

interface Sent {
  added: { id: string; source: string; title: string; delivered: string[] }[];
  refused: { source: string; title: string; reason: string }[];
  roomToday: number;
}

/**
 * Adds the notes the rules allow, delivers each through every chosen adapter, records who took it, and redraws.
 */
export const sendNotes = async (inputs: readonly NoteInput[], adapters: readonly NoteAdapter[], now: Date): Promise<Sent> => {
  const problem = notesProblem();
  if (problem) {
    throw new Error(problem);
  }
  const { ledger, added, refused } = addNotes(readNotes(), inputs, now);
  writeNotes(ledger);
  const context = noteContext(now);
  const chosen = chosenAdapters(adapters, context);
  const results = await Promise.all(added.map(async (note: Note) => ({ note, by: await deliverNote(note, chosen, context) })));
  // Read again: delivery can take seconds, and a reaction recorded meanwhile must not be written over.
  const final = results.reduce((current, { note, by }) => delivered(current, note.id, by), readNotes());
  writeNotes(final);
  if (added.length) {
    publishNotes(chosen, context);
  }
  return {
    added: results.map(({ note, by }) => ({ id: note.id, source: note.source, title: note.title, delivered: by })),
    refused,
    roomToday: roomToday(final, now)
  };
};
