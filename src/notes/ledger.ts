import { FILES } from '@/config';
import { isRecord } from '@/shared/json-block';
import { jsonProblem, writeJsonChecked } from '@/shared/utils';
import { readFileSync } from 'node:fs';

const REACTIONS = ['', 'useful', 'dismissed', 'started'] as const;
export type Reaction = (typeof REACTIONS)[number];

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
  /**
   * The whole first message of a session that takes the next step, '' when there is none to start.
   */
  prompt: string;
  reaction: Reaction;
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
}

export const EMPTY_NOTES: NoteLedger = { notes: [] };

const TEXT_FIELDS = ['id', 'at', 'source', 'lens', 'title', 'body', 'next', 'prompt'] as const;

const isReaction = (value: unknown): value is Reaction => REACTIONS.some((reaction) => reaction === value);

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
    prompt: required('prompt'),
    reaction: isReaction(data.reaction) ? data.reaction : '',
    laterUntil: text('laterUntil'),
    folder: text('folder'),
    workspace: text('workspace')
  };
};

export const parseNotes = (data: unknown): NoteLedger => {
  if (!isRecord(data) || !Array.isArray(data.notes)) {
    return EMPTY_NOTES;
  }
  return { notes: data.notes.map(parseNote).filter((note): note is Note => note !== null) };
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
