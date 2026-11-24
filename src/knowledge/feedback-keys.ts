export interface StatementKey {
  day: string;
  session: string;
  hash: string;
}

export interface KeyedEntry extends StatementKey {
  label: string;
}

export const NO_SESSION = '-';

/**
 * Lowercased letters and digits, one space between words, so wording that differs only in case and punctuation
 * compares equal.
 */
export const normalizedWords = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const KEYED_HEADER_RE = /^## (\d{4}-\d{2}-\d{2})(?: — ([^\n]*?))? \[([0-9a-fA-F-]+):([0-9a-f]{16})\]$/gm;

export const keyedHeader = ({ day, session, hash }: StatementKey, label: string): string =>
  `## ${day}${label ? ` — ${label}` : ''} [${session}:${hash}]`;

export const keyedEntries = (log: string): KeyedEntry[] =>
  [...log.matchAll(KEYED_HEADER_RE)].map(([, day, label = '', session, hash]) => ({ day, label, session, hash }));

/**
 * Two keys name one statement when the words match and the session does. An entry written live has no session, so
 * it matches by words and day instead: the same sentence on another day is a second statement.
 */
export const sameStatement = (a: StatementKey, b: StatementKey): boolean =>
  a.hash === b.hash &&
  (a.session !== NO_SESSION && b.session !== NO_SESSION ? a.session === b.session : a.day === b.day);
