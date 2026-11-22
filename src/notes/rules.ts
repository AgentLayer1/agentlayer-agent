import { nowISO, todayDate } from '@/shared/date';
import type { Note, NoteLedger, Reaction } from './ledger';

/**
 * The most notes in one day, in the home's timezone.
 */
export const DAILY_CAP = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
// A source isn't noted again for two weeks, and a note older than two months is dropped.
const REPEAT_MS = 14 * DAY_MS;
const KEEP_MS = 60 * DAY_MS;

export type NoteInput = Pick<Note, 'source' | 'lens' | 'title' | 'body' | 'sources' | 'next'> & Partial<Pick<Note, 'prompt'>>;

interface Refusal {
  source: string;
  title: string;
  reason: string;
}

interface Added {
  ledger: NoteLedger;
  added: Note[];
  refused: Refusal[];
}

const ms = (iso: string): number => Date.parse(iso) || 0;

const isPublicUrl = (text: string): boolean => /^https?:\/\/[^\s/]+\.[^\s]+$/.test(text);

/**
 * The notes sent on `now`'s day in the home's timezone.
 */
export const notesOn = (ledger: NoteLedger, now: Date): Note[] =>
  ledger.notes.filter((note) => todayDate(new Date(ms(note.at))) === todayDate(now));

export const roomToday = (ledger: NoteLedger, now: Date): number => Math.max(0, DAILY_CAP - notesOn(ledger, now).length);

const randomId = (): string => `n-${Math.random().toString(36).slice(2, 6)}`;

const freshId = (taken: ReadonlySet<string>, makeId: () => string): string => {
  const id = makeId();
  return taken.has(id) ? freshId(taken, makeId) : id;
};

// Why a note can't go out now, or '' when it can.
const blockedBy = (ledger: NoteLedger, input: NoteInput, now: Date): string => {
  if (roomToday(ledger, now) === 0) {
    return `${DAILY_CAP} notes already went out today`;
  }
  if (ledger.notes.some((note) => note.source === input.source && now.getTime() - ms(note.at) < REPEAT_MS)) {
    return 'noted in the last two weeks';
  }
  return input.sources.some(isPublicUrl) ? '' : 'no public source to back it';
};

/**
 * Adds each input that the day's cap, a recent note on the same source, or a missing public source doesn't stop.
 */
export const addNotes = (
  ledger: NoteLedger,
  inputs: readonly NoteInput[],
  now: Date,
  makeId: () => string = randomId
): Added =>
  inputs.reduce<Added>(
    (result, input) => {
      const reason = blockedBy(result.ledger, input, now);
      if (reason) {
        return { ...result, refused: [...result.refused, { source: input.source, title: input.title, reason }] };
      }
      const note: Note = {
        ...input,
        prompt: input.prompt ?? '',
        id: freshId(new Set(result.ledger.notes.map(({ id }) => id)), makeId),
        at: nowISO(now),
        reaction: '',
        delivered: []
      };
      return { ...result, ledger: { notes: [...result.ledger.notes, note] }, added: [...result.added, note] };
    },
    { ledger: { notes: ledger.notes.filter((note) => now.getTime() - ms(note.at) < KEEP_MS) }, added: [], refused: [] }
  );

/**
 * The notes a surface shows: today's and yesterday's in the home's timezone, never a dismissed one, unread first,
 * then newest first.
 */
export const recentNotes = (ledger: NoteLedger, now: Date): Note[] => {
  const days = new Set([todayDate(now), todayDate(new Date(now.getTime() - DAY_MS))]);
  return ledger.notes
    .filter((note) => note.reaction !== 'dismissed' && days.has(todayDate(new Date(ms(note.at)))))
    .toSorted((a, b) => Number(a.reaction !== '') - Number(b.reaction !== '') || ms(b.at) - ms(a.at));
};

export const delivered = (ledger: NoteLedger, id: string, adapters: readonly string[]): NoteLedger => ({
  notes: ledger.notes.map((note) =>
    note.id === id ? { ...note, delivered: [...new Set([...note.delivered, ...adapters])] } : note
  )
});

/**
 * Records how the operator took a note; unknown when no note has the id.
 */
export const react = (ledger: NoteLedger, id: string, reaction: Exclude<Reaction, ''>): NoteLedger | null =>
  ledger.notes.some((note) => note.id === id)
    ? { notes: ledger.notes.map((note) => (note.id === id ? { ...note, reaction } : note)) }
    : null;

/**
 * Each lens's record: when it last produced a note, and how its notes were received.
 */
export const lensRecord = (
  ledger: NoteLedger
): Record<string, { lastAt: string; notes: number; useful: number; dismissed: number }> =>
  ledger.notes.reduce<Record<string, { lastAt: string; notes: number; useful: number; dismissed: number }>>(
    (record, note) => {
      const current = record[note.lens] ?? { lastAt: '', notes: 0, useful: 0, dismissed: 0 };
      return {
        ...record,
        [note.lens]: {
          lastAt: ms(note.at) > ms(current.lastAt) ? note.at : current.lastAt,
          notes: current.notes + 1,
          useful: current.useful + Number(note.reaction === 'useful'),
          dismissed: current.dismissed + Number(note.reaction === 'dismissed')
        }
      };
    },
    {}
  );
