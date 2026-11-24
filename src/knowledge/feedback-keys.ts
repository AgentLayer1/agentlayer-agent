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

/** The distinct words of at least `minLength` letters or digits, case and punctuation aside. */
export const contentWords = (text: string, minLength = 3): Set<string> =>
  new Set(
    normalizedWords(text)
      .split(' ')
      .filter((word) => word.length >= minLength)
  );

export interface FeedbackEntry {
  date: string;
  label: string;
  session: string | null;
  body: string;
}

// Every header the log has held: the keyed form above, the dash form `capture` writes, and an early `·` form.
const ENTRY_HEADER_RE = /^## (\d{4}-\d{2}-\d{2})\S*(?:\s+[·—]\s+(.*?))?(?:\s+\[([0-9a-fA-F-]+):[0-9a-f]{16}\])?\s*$/;

/** The log's entries in order, each from its `## <date>` header to the next. */
export const feedbackEntries = (log: string): FeedbackEntry[] =>
  log.split(/^(?=## \d{4}-\d{2}-\d{2})/m).flatMap((chunk) => {
    const [header = '', ...rest] = chunk.split('\n');
    const match = ENTRY_HEADER_RE.exec(header);
    return match
      ? [
          {
            date: match[1],
            label: (match[2] ?? '').trim(),
            session: match[3] && match[3] !== NO_SESSION ? match[3] : null,
            body: rest
              .join('\n')
              .replace(/\n---\s*$/, '')
              .trim()
          }
        ]
      : [];
  });

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
