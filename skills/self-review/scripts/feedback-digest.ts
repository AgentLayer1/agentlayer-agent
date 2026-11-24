#!/usr/bin/env bun
/**
 * The feedback log read once, by code, so a rules pass reads only what is new. Prints, for entries after the review
 * watermark's `lastProcessed` (every entry with `--full`): each one's date, label, session and first line; counts by
 * month and by label; and every graduation marker with the later entries that share its rule's words, the leads for
 * a rule that broke after it graduated. Read-only.
 *
 * Usage: feedback-digest.ts [--home <dir>] [--full]   (--home: else the agent's home variable, else the cwd)
 */
import { join, resolve } from 'node:path';
import { contentWords, feedbackEntries, type FeedbackEntry } from '../../../src/knowledge/feedback-keys';
import { readTextIfExists } from '../../../src/shared/text';
import { truncate } from '../../../src/status/format';

const MARKER = /^graduated(?:-rule)?:\s*/;
// A word in more than this share of entries says nothing about which rule an entry is about.
const COMMON = 0.1;
const MIN_SHARED = 3;
// Shared words over the geometric mean of both sides' distinctive words, so a long entry that mentions everything
// doesn't match every rule.
const OVERLAP = 0.12;
const LEADS = 5;
const EXCERPT = 200;

const firstLine = (body: string): string =>
  truncate((body.split('\n').find((line) => line.trim()) ?? '').replace(/^>\s*/, '').trim(), EXCERPT);

const keyWords = (text: string): Set<string> => contentWords(text, 4);

interface Recurrence {
  date: string;
  theme: string;
  matches: number;
  later: { date: string; label: string; line: string }[];
}

const countBy = (values: readonly string[]): Map<string, number> =>
  values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<string, number>());

// What a marker graduated: its theme and the rule it quotes, not the note on where the rule now lives.
const graduatedText = (marker: FeedbackEntry): string =>
  `${marker.label.replace(MARKER, '')} ${marker.body.split(/\bNow lives in\b/)[0]}`;

/**
 * Each graduation marker with the later entries that share enough of its words to be the same rule breaking again.
 * Leads, not verdicts: the pass reads each one before calling it a recurrence.
 */
const recurrences = (entries: readonly FeedbackEntry[]): Recurrence[] => {
  const worded = entries.map((entry) => keyWords(`${entry.label} ${entry.body}`));
  const spread = countBy(worded.flatMap((words) => [...words]));
  const distinctive = (words: Set<string>): Set<string> =>
    new Set([...words].filter((word) => (spread.get(word) ?? 0) <= COMMON * entries.length));
  const said = entries.map((entry, index) => ({ entry, words: distinctive(worded[index]) }));
  return entries.flatMap((marker, position) => {
    if (!MARKER.test(marker.label)) {
      return [];
    }
    const ruleWords = distinctive(keyWords(graduatedText(marker)));
    const matched = said
      .slice(position + 1)
      .filter(({ entry }) => !MARKER.test(entry.label))
      .map(({ entry, words }) => {
        const shared = [...words].filter((word) => ruleWords.has(word)).length;
        return { entry, shared, overlap: shared / Math.sqrt(Math.max(1, words.size * ruleWords.size)) };
      })
      .filter(({ shared, overlap }) => shared >= MIN_SHARED && overlap >= OVERLAP)
      .toSorted((a, b) => b.overlap - a.overlap);
    return [
      {
        date: marker.date,
        theme: marker.label.replace(MARKER, ''),
        matches: matched.length,
        later: matched
          .slice(0, LEADS)
          .map(({ entry }) => ({ date: entry.date, label: entry.label, line: firstLine(entry.body) }))
      }
    ];
  });
};

export const digest = (log: string, since: string | null) => {
  const entries = feedbackEntries(log);
  const fresh = since ? entries.filter((entry) => entry.date > since) : entries;
  return {
    since,
    total: entries.length,
    byMonth: Object.fromEntries(countBy(entries.map((entry) => entry.date.slice(0, 7)))),
    fresh: {
      count: fresh.length,
      byLabel: Object.fromEntries(countBy(fresh.map((entry) => entry.label || '(none)'))),
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
      const value = (JSON.parse(readTextIfExists(reviewPath)) as { lastProcessed?: unknown }).lastProcessed;
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  })();
  const log = readTextIfExists(FILES.FEEDBACK);
  const since = args.includes('--full') ? null : lastProcessed;
  process.stdout.write(`${JSON.stringify({ log: FILES.FEEDBACK, ...digest(log, since) }, null, 2)}\n`);
}
