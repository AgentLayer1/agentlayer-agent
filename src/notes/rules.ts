import { DAY_MS, isoMs, nextMorning, nowISO, todayDate } from '@/shared/date';
import type { MessageChoice } from '@/shared/message';
import { freshId, shortId } from '@/shared/utils';
import type { Note, NoteLedger } from './ledger';

const randomId = shortId('n');

/**
 * The most notes in one day, in the home's timezone.
 */
export const DAILY_CAP = 3;

const REPEAT_MS = 14 * DAY_MS;
const KEEP_MS = 60 * DAY_MS;
// A note nobody acted on leaves the list after a week, so it can't pile up.
const OPEN_MS = 7 * DAY_MS;

export type NoteInput = Pick<Note, 'source' | 'lens' | 'title' | 'body' | 'sources' | 'next'> &
  Partial<Pick<Note, 'folder' | 'workspace'>>;

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

// A page anyone can open, or a file in the home, for a finding about the brain itself. Whether a URL is public is the
// skill's to check; the shape is all this sees.
const isSourceRef = (text: string): boolean =>
  /^https?:\/\/[^\s/]+\.[^\s]+$/.test(text) || /^(knowledge|projects|reports)\/[^\s]+$/.test(text);

/**
 * The notes sent on `now`'s day in the home's timezone.
 */
export const notesOn = (ledger: NoteLedger, now: Date): Note[] => {
  const day = todayDate(now);
  return ledger.notes.filter((note) => todayDate(new Date(isoMs(note.at))) === day);
};

/**
 * The notes of the last two weeks, whose sources can't be noted again yet.
 */
export const sentLately = (ledger: NoteLedger, now: Date): Note[] =>
  ledger.notes.filter((note) => now.getTime() - isoMs(note.at) < REPEAT_MS);

export const roomToday = (ledger: NoteLedger, now: Date): number => Math.max(0, DAILY_CAP - notesOn(ledger, now).length);

// Why a note can't go out now, or '' when it can.
const blockedBy = (ledger: NoteLedger, input: NoteInput, now: Date): string => {
  if (roomToday(ledger, now) === 0) {
    return `${DAILY_CAP} notes already went out today`;
  }
  if (sentLately(ledger, now).some((note) => note.source === input.source)) {
    return 'noted in the last two weeks';
  }
  if (ledger.notes.some((note) => note.source === input.source && note.state === 'dismissed')) {
    return 'dismissed by the operator';
  }
  return input.sources.some(isSourceRef) ? '' : 'no source to back it: a URL, or a file in the home';
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
        folder: input.folder ?? '',
        workspace: input.workspace ?? '',
        id: freshId(new Set(result.ledger.notes.map(({ id }) => id)), makeId),
        at: nowISO(now),
        state: 'waiting',
        decidedAt: '',
        laterUntil: ''
      };
      return { ...result, ledger: { notes: [...result.ledger.notes, note] }, added: [...result.added, note] };
    },
    { ledger: { notes: ledger.notes.filter((note) => now.getTime() - isoMs(note.at) < KEEP_MS) }, added: [], refused: [] }
  );

/**
 * The notes still waiting on the operator, newest first: none acted on, from the last week, those put off with Later
 * included (a surface hides them until their time).
 */
export const openNotes = (ledger: NoteLedger, now: Date): Note[] =>
  ledger.notes
    .filter((note) => note.state === 'waiting' && now.getTime() - Math.max(isoMs(note.at), isoMs(note.laterUntil)) < OPEN_MS)
    .toSorted((a, b) => isoMs(b.at) - isoMs(a.at));

type NoteDecision =
  | { outcome: 'decided'; ledger: NoteLedger; note: Note }
  | { outcome: 'unknown' }
  | { outcome: 'already'; note: Note };

/**
 * Records the operator's choice. Start and Dismiss are final, so a second Start changes nothing and a double click
 * can't open two sessions; Later puts the note off until the next morning and can be chosen again.
 */
export const decideNote = (ledger: NoteLedger, id: string, choice: MessageChoice, now: Date): NoteDecision => {
  const found = ledger.notes.find((note) => note.id === id);
  if (!found) {
    return { outcome: 'unknown' };
  }
  if (found.state !== 'waiting') {
    return { outcome: 'already', note: found };
  }
  const note: Note =
    choice === 'later'
      ? { ...found, laterUntil: nextMorning(now) }
      : { ...found, state: choice === 'start' ? 'started' : 'dismissed', laterUntil: '', decidedAt: nowISO(now) };
  return { outcome: 'decided', ledger: { notes: ledger.notes.map((item) => (item.id === id ? note : item)) }, note };
};

/**
 * Puts a started note back, when its session couldn't open.
 */
export const reopenNote = (ledger: NoteLedger, id: string): NoteLedger => ({
  notes: ledger.notes.map((note) => (note.id === id ? { ...note, state: 'waiting', decidedAt: '' } : note))
});

/**
 * The first message of the session Start opens, built from what the card showed, under a reach the code sets: a scout
 * that read untrusted pages never writes what a session runs.
 */
export const notePrompt = (note: Note): string =>
  [
    `A note you sent on your own: ${note.title}`,
    '',
    note.body,
    '',
    `Next step: ${note.next}`,
    `Sources: ${note.sources.join(', ')}`,
    '',
    'Work on this next step with me. Drafts only: never send, post, pay, merge or delete anything. Start by saying what you would do first, then stop for my go.'
  ].join('\n');

interface LensStats {
  lastAt: string;
  notes: number;
  started: number;
  dismissed: number;
}

/**
 * Each lens's record: when it last produced a note, and how its notes were received.
 */
export const lensRecord = (ledger: NoteLedger): Record<string, LensStats> =>
  Object.fromEntries(
    ledger.notes.reduce((record, note) => {
      const current = record.get(note.lens) ?? { lastAt: '', notes: 0, started: 0, dismissed: 0 };
      return new Map(record).set(note.lens, {
        lastAt: isoMs(note.at) > isoMs(current.lastAt) ? note.at : current.lastAt,
        notes: current.notes + 1,
        started: current.started + Number(note.state === 'started'),
        dismissed: current.dismissed + Number(note.state === 'dismissed')
      });
    }, new Map<string, LensStats>())
  );
