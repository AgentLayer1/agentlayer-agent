import { FILES } from '@/config';
import { isRecord } from '@/shared/json-block';
import { writeJsonAtomic } from '@/shared/utils';
import { existsSync, readFileSync } from 'node:fs';

const REACTIONS = ['', 'useful', 'dismissed'] as const;
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
  /**
   * The public pages that back it.
   */
  sources: string[];
  next: string;
  /**
   * The whole first message of a session that takes the next step, '' when there is none to start.
   */
  prompt: string;
  reaction: Reaction;
  /**
   * The adapters that delivered it.
   */
  delivered: string[];
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
  const text = (field: (typeof TEXT_FIELDS)[number]): string => String(data[field]);
  return {
    id: text('id'),
    at: text('at'),
    source: text('source'),
    lens: text('lens'),
    title: text('title'),
    body: text('body'),
    sources: strings(data.sources),
    next: text('next'),
    prompt: text('prompt'),
    reaction: isReaction(data.reaction) ? data.reaction : '',
    delivered: strings(data.delivered)
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
export const notesProblem = (): string => {
  if (!existsSync(FILES.NOTES)) {
    return '';
  }
  try {
    return isRecord(JSON.parse(readFileSync(FILES.NOTES, 'utf-8'))) ? '' : `${FILES.NOTES} is not a JSON object.`;
  } catch {
    return `${FILES.NOTES} is not valid JSON; fix or remove it, then try again.`;
  }
};

/**
 * Replaces the ledger, unless the file won't parse: that one is left for the operator rather than written over.
 */
export const writeNotes = (ledger: NoteLedger): void => {
  const problem = notesProblem();
  if (problem) {
    throw new Error(problem);
  }
  writeJsonAtomic(FILES.NOTES, ledger);
};
