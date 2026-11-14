import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENTRY_SPLIT_RE } from '../../../src/knowledge/session-format';

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;
/** An entry's own heading: the first in its piece, since a day's first entry follows the log's title. */
const HEADING = /^### (Session|Pre-Compact) \(([^)]*)\) \[([0-9a-fA-F-]+)\]/m;
const TURNS = / · turns (\d+)–(\d+)/;
const SPEAKER = /^\*\*(User|Assistant):\*\*/m;
const USER_SNIPPET = 300;
const COMMAND = /<command-name>([^<]+)<\/command-name>/g;
/** Text the host injected into a user turn rather than words the operator typed. */
const INJECTED = /^(<|Base directory for this skill:|This session is being continued)/;

/** One captured entry of a session: where it sits in a day log, so it can be read back. */
export interface BrainBlock {
  file: string;
  /** 1-based first and last line of the entry in `file`. */
  start_line: number;
  end_line: number;
  date: string;
  turns: string | null;
  hits: number;
}

export interface BrainMatch {
  session_id: string;
  first_date: string;
  last_date: string;
  first_user_msg: string | null;
  slash_commands: string[];
  hits: Record<string, number>;
  total_hits: number;
  terms_in_user_prompts: string[];
  blocks: BrainBlock[];
}

interface Entry {
  id: string;
  block: Omit<BrainBlock, 'hits'>;
  lowered: string;
  userTurns: string[];
}

const countOccurrences = (haystack: string, needle: string): number =>
  needle ? haystack.split(needle).length - 1 : 0;

/** The operator's own words in an entry: every `**User:**` turn, up to the next speaker. */
const userTurns = (body: string): string[] => {
  const parts = body.split(SPEAKER);
  return parts.flatMap((part, index) => (parts[index - 1] === 'User' ? [part.trim()] : []));
};

/** Every entry of one day log, with the line range it occupies. */
const entriesOf = (dir: string, name: string, date: string): Entry[] => {
  const file = join(dir, name);
  const pieces = readFileSync(file, 'utf-8').split(ENTRY_SPLIT_RE);
  const newlines = pieces.map((piece) => piece.split('\n').length - 1);
  const starts = newlines.reduce<number[]>((lines, _, index) => [...lines, index === 0 ? 1 : lines[index - 1] + newlines[index - 1]], []);
  return pieces.flatMap((piece, index) => {
    const heading = HEADING.exec(piece);
    if (!heading) {
      return [];
    }
    const entry = piece.slice(heading.index);
    const turns = TURNS.exec(entry.split('\n', 1)[0]);
    const start = starts[index] + piece.slice(0, heading.index).split('\n').length - 1;
    const body = entry.replace(/\s*\n---\s*$/, '').replace(/\n+$/, '');
    return [
      {
        id: heading[3],
        lowered: body.toLowerCase(),
        userTurns: userTurns(body),
        block: {
          file,
          start_line: start,
          end_line: start + body.split('\n').length - 1,
          date,
          turns: turns ? `${turns[1]}–${turns[2]}` : null
        }
      }
    ];
  });
};

/**
 * Sessions in the brain's day logs whose captured text holds any of `terms` (lowercase),
 * each with the entries to read back, most hits first. `since` (YYYY-MM-DD) skips older days.
 */
export const searchBrain = (sessionsDir: string, terms: readonly string[], since: string | null): BrainMatch[] => {
  if (!existsSync(sessionsDir)) {
    return [];
  }
  const entries = readdirSync(sessionsDir)
    .flatMap((name) => {
      const date = DAY_FILE.exec(name)?.[1];
      return date && (since === null || date >= since) ? [{ name, date }] : [];
    })
    .sort((first, second) => first.date.localeCompare(second.date))
    .flatMap(({ name, date }) => entriesOf(sessionsDir, name, date));

  const bySession = Map.groupBy(entries, (entry) => entry.id);
  return [...bySession.entries()]
    .flatMap(([id, sessionEntries]) => {
      const counts = sessionEntries.map((entry) => terms.map((term) => countOccurrences(entry.lowered, term)));
      const hits = Object.fromEntries(
        terms
          .map((term, index) => [term, counts.reduce((sum, row) => sum + row[index], 0)] as const)
          .filter(([, count]) => count > 0)
      );
      if (Object.keys(hits).length === 0) {
        return [];
      }
      const turnsByUser = sessionEntries.flatMap((entry) => entry.userTurns);
      const typed = turnsByUser.filter((turn) => !INJECTED.test(turn));
      const userText = typed.join('\n').toLowerCase();
      const firstUser = typed[0];
      return [
        {
          session_id: id,
          first_date: sessionEntries[0].block.date,
          last_date: sessionEntries[sessionEntries.length - 1].block.date,
          first_user_msg: firstUser ? [...firstUser].slice(0, USER_SNIPPET).join('') : null,
          slash_commands: [...new Set(turnsByUser.flatMap((turn) => [...turn.matchAll(COMMAND)].map((match) => match[1])))],
          hits,
          total_hits: Object.values(hits).reduce((sum, count) => sum + count, 0),
          terms_in_user_prompts: terms.filter((term) => userText.includes(term)),
          blocks: sessionEntries.map((entry, index) => ({ ...entry.block, hits: counts[index].reduce((sum, count) => sum + count, 0) }))
        }
      ];
    })
    .sort((first, second) => second.total_hits - first.total_hits || second.last_date.localeCompare(first.last_date));
};
