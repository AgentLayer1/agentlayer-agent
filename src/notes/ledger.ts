import { FILES } from '@/config';
import { isRecord } from '@/shared/json-block';
import { jsonProblem, writeJsonChecked } from '@/shared/utils';
import { readFileSync } from 'node:fs';

const STATES = ['waiting', 'started', 'dismissed'] as const;
export type NoteState = (typeof STATES)[number];

/**
 * A short finding the agent checked against a live source and sent on its own, with one next step.
 */
export interface Note {
  id: string;
  at: string;
  /**
   * What it is about, the key that keeps it from being sent twice (`site:install-snippet`, `task:ab-012`).
   */
  source: string;
  /**
   * The angle it came from (public drift, opportunities, signals, the brain, waiting on you).
   */
  lens: string;
  title: string;
  body: string;
  sources: string[];
  next: string;
  state: NoteState;
  /**
   * When the operator started or dismissed it, an ISO time; '' while it waits.
   */
  decidedAt: string;
  /**
   * When a note put off with Later shows again, an ISO time with an offset; '' when it shows now.
   */
  laterUntil: string;
  /**
   * The folder the next step's work lives in, and the title of the workspace the agent picked for it; '' when none.
   */
  folder: string;
  workspace: string;
}

export interface NoteLedger {
  notes: Note[];
  /**
   * When each lens was last handed out to a scouting run, an ISO time by lens key, so a lens that finds nothing still
   * takes its turn.
   */
  ranAt?: Record<string, string>;
}

export const EMPTY_NOTES: NoteLedger = { notes: [] };

const TEXT_FIELDS = ['id', 'at', 'source', 'lens', 'title', 'body', 'next'] as const;

const isState = (value: unknown): value is NoteState => STATES.some((state) => state === value);

// A note recorded before notes had a state says how the operator took it as `reaction` ('' while it waited).
const stateOf = (data: Record<string, unknown>): NoteState => {
  if (isState(data.state)) {
    return data.state;
  }
  return data.reaction === 'started' || data.reaction === 'dismissed' ? data.reaction : 'waiting';
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

// A hand-edited entry missing a field is dropped, never half-read.
const parseNote = (data: unknown): Note | null => {
  if (!isRecord(data) || !TEXT_FIELDS.every((field) => typeof data[field] === 'string')) {
    return null;
  }
  const required = (field: (typeof TEXT_FIELDS)[number]): string => String(data[field]);
  // Fields added after the first notes went out read as '' in an older ledger.
  const text = (field: string): string => (typeof data[field] === 'string' ? String(data[field]) : '');
  return {
    id: required('id'),
    at: required('at'),
    source: required('source'),
    lens: required('lens'),
    title: required('title'),
    body: required('body'),
    sources: strings(data.sources),
    next: required('next'),
    state: stateOf(data),
    decidedAt: text('decidedAt'),
    laterUntil: text('laterUntil'),
    folder: text('folder'),
    workspace: text('workspace')
  };
};

export const parseNotes = (data: unknown): NoteLedger => {
  if (!isRecord(data) || !Array.isArray(data.notes)) {
    return EMPTY_NOTES;
  }
  const ranAt = isRecord(data.ranAt)
    ? Object.fromEntries(
        Object.entries(data.ranAt).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
    : {};
  return { notes: data.notes.map(parseNote).filter((note): note is Note => note !== null), ranAt };
};

export const readNotes = (): NoteLedger => {
  try {
    return parseNotes(JSON.parse(readFileSync(FILES.NOTES, 'utf-8')));
  } catch {
    return EMPTY_NOTES;
  }
};

/**
 * What's wrong with the ledger file, or '' when it is missing or reads.
 */
export const notesProblem = (): string => jsonProblem(FILES.NOTES);

export const writeNotes = (ledger: NoteLedger): void => writeJsonChecked(FILES.NOTES, ledger);
