#!/usr/bin/env bun
/**
 * The feedback log read once, by code, so a rules pass reads only what is new. Prints, for entries after the review
 * watermark's `lastProcessed` (every entry with `--full`): each one's date, label, session and first line; counts by
 * month and by label; and every graduation marker with the later entries that share its rule's words, the leads for
 * a rule that broke after it graduated. Read-only.
 *
 * Usage: feedback-digest.ts [--home <dir>] [--full]   (--home: else the agent's home variable, else the cwd)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizedWords } from '../../../src/knowledge/feedback-keys';

export interface Entry {
  date: string;
  label: string;
  session: string | null;
  body: string;
}

const HEADER = /^## (\d{4}-\d{2}-\d{2})\S*(?:\s+[·—]\s+(.*?))?(?:\s+\[([0-9a-fA-F-]+):[0-9a-f]{16}\])?\s*$/;
const MARKER = /^graduated(?:-rule)?:\s*/;
// A word in more than this share of entries says nothing about which rule an entry is about.
const COMMON = 0.1;
const MIN_SHARED = 3;
// Shared words over the geometric mean of both sides' distinctive words, so a long entry that mentions everything
// doesn't match every rule.
const OVERLAP = 0.12;
const LEADS = 5;
const EXCERPT = 200;

const excerpt = (text: string): string => (text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text);

/** The log's entries in order, each from its `## <date>` header to the next. */
export const parseEntries = (log: string): Entry[] =>
  log.split(/^(?=## \d{4}-\d{2}-\d{2})/m).flatMap((chunk) => {
    const [header = '', ...rest] = chunk.split('\n');
    const match = HEADER.exec(header);
    return match
      ? [
          {
            date: match[1],
            label: (match[2] ?? '').trim(),
            session: match[3] && match[3] !== '-' ? match[3] : null,
            body: rest
              .join('\n')
              .replace(/\n---\s*$/, '')
              .trim()
          }
        ]
      : [];
  });

const firstLine = (body: string): string =>
  excerpt((body.split('\n').find((line) => line.trim()) ?? '').replace(/^>\s*/, '').trim());

const keyWords = (text: string): Set<string> =>
  new Set(
    normalizedWords(text)
      .split(' ')
      .filter((word) => word.length > 3)
  );

export interface Recurrence {
  date: string;
  label: string;
  theme: string;
  matches: number;
  later: { date: string; label: string; line: string }[];
}

// What a marker graduated: its theme and the rule it quotes, not the note on where the rule now lives.
const graduatedText = (marker: Entry): string =>
  `${marker.label.replace(MARKER, '')} ${marker.body.split(/\bNow lives in\b/)[0]}`;

/**
 * Each graduation marker with the later entries that share enough of its words to be the same rule breaking again.
 * Leads, not verdicts: the pass reads each one before calling it a recurrence.
 */
export const recurrences = (entries: readonly Entry[]): Recurrence[] => {
  const worded = entries.map((entry) => keyWords(`${entry.label} ${entry.body}`));
  const spread = worded.reduce(
    (counts, words) => [...words].reduce((inner, word) => inner.set(word, (inner.get(word) ?? 0) + 1), counts),
    new Map<string, number>()
  );
  const distinctive = (words: Set<string>): Set<string> =>
    new Set([...words].filter((word) => (spread.get(word) ?? 0) <= COMMON * entries.length));
  return entries.flatMap((marker, position) => {
    if (!MARKER.test(marker.label)) {
      return [];
    }
    const ruleWords = distinctive(keyWords(graduatedText(marker)));

    const matched = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => index > position && !MARKER.test(entry.label))
      .map(({ entry, index }) => {
        const said = distinctive(worded[index]);
        const shared = [...said].filter((word) => ruleWords.has(word)).length;
        return { entry, shared, overlap: shared / Math.sqrt(Math.max(1, said.size * ruleWords.size)) };
      })
      .filter(({ shared, overlap }) => shared >= MIN_SHARED && overlap >= OVERLAP)
      .toSorted((a, b) => b.overlap - a.overlap);
    return [
      {
        date: marker.date,
        label: marker.label,
        theme: marker.label.replace(MARKER, ''),
        matches: matched.length,
        later: matched
          .slice(0, LEADS)
          .map(({ entry }) => ({ date: entry.date, label: entry.label, line: firstLine(entry.body) }))
      }
    ];
  });
};

const countBy = (values: readonly string[]): Record<string, number> =>
  values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});

export const digest = (log: string, since: string | null) => {
  const entries = parseEntries(log);
  const fresh = since ? entries.filter((entry) => entry.date > since) : entries;
  return {
    since,
    total: entries.length,
    byMonth: countBy(entries.map((entry) => entry.date.slice(0, 7))),
    fresh: {
      count: fresh.length,
      byLabel: countBy(fresh.map((entry) => entry.label || '(none)')),
      entries: fresh.map((entry) => ({
        date: entry.date,
        label: entry.label,
        session: entry.session,
        line: firstLine(entry.body)
      }))
    },
    markers: recurrences(entries)
  };
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const homeFlag = args.indexOf('--home') === -1 ? undefined : args[args.indexOf('--home') + 1];
  if (homeFlag) process.env.AGENT_HOME = resolve(homeFlag);
  process.env.AGENT_LOG_FILE = 'off';
  const { FILES, FOLDERS } = await import('../../../src/config');
  const { agentHomePath, isAgentHome } = await import('../../../src/shared/env');
  if (!isAgentHome(agentHomePath())) {
    console.error(`not an agent home: ${agentHomePath()}`);
    process.exit(2);
  }
  const reviewPath = join(FOLDERS.DATA, 'review.json');
  const lastProcessed = (() => {
    try {
      const value = (JSON.parse(readFileSync(reviewPath, 'utf-8')) as { lastProcessed?: unknown }).lastProcessed;
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  })();
  const log = existsSync(FILES.FEEDBACK) ? readFileSync(FILES.FEEDBACK, 'utf-8') : '';
  const since = args.includes('--full') ? null : lastProcessed;
  process.stdout.write(`${JSON.stringify({ log: FILES.FEEDBACK, ...digest(log, since) }, null, 2)}\n`);
}
