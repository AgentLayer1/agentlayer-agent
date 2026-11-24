/**
 * Single source of truth for the session-log entry format. The writer
 * (`session-capture.ts`) and its readers (`chunk.ts`, `session-index.ts`,
 * `hooks/context.ts`) import from here, so any change to the separator or header shape
 * propagates to everyone that needs to stay in sync.
 */

/** Literal byte sequence the writer emits between entries. */
export const ENTRY_SEPARATOR = '\n\n---\n\n';

const ENTRY_HEADER_PATTERN = '### (?:Session|Pre-Compact) \\(';
const SESSION_HEADER_PATTERN = '### Session \\(\\d{2}:\\d{2}\\) ';
const ESCAPED_SEPARATOR = ENTRY_SEPARATOR.replace(/\n/g, '\\n');

/** The bold role label that opens each turn in an entry: `**User:**` or `**Assistant:**`. */
export const TURN_MARKER = '\\*\\*(?:User|Assistant):\\*\\*';

/** A turn's text with a role label at the start of any line escaped, so a quoted `**User:**` never reads as a turn. */
export const escapeTurnMarkers = (text: string): string =>
  text.replace(new RegExp(`^(?=${TURN_MARKER})\\*\\*`, 'gm'), '\\*\\*');

/** Matches an entry header opening (Session or Pre-Compact) at line start. */
export const ENTRY_HEADER_RE = new RegExp(`^${ENTRY_HEADER_PATTERN}`, 'm');

/**
 * Splits a body into entry-aligned chunks. Requires either start-of-body or
 * the literal `ENTRY_SEPARATOR` immediately before each header — keeps
 * headers inside fenced code blocks from triggering false splits.
 */
export const ENTRY_SPLIT_RE = new RegExp(`(?<=^|${ESCAPED_SEPARATOR})(?=${ENTRY_HEADER_PATTERN})`);

/**
 * Locates each `ENTRY_SEPARATOR` immediately followed by a Session header
 * (not Pre-Compact). Consume via `matchAll` to avoid the shared-state hazard
 * that comes with `/g` + `exec`.
 */
export const SESSION_BLOCK_SEPARATOR_RE = new RegExp(`${ESCAPED_SEPARATOR}(?=${SESSION_HEADER_PATTERN})`, 'g');

/** Matches a Session header at line start — fallback when no separators exist. */
export const FIRST_SESSION_HEADER_RE = new RegExp(`^${SESSION_HEADER_PATTERN}`, 'm');

/** Matches a trailing `ENTRY_SEPARATOR` + whitespace at end-of-block. */
export const TRAILING_SEPARATOR_RE = new RegExp(`${ESCAPED_SEPARATOR}\\s*$`);

// ── Entry header: format + parse ─────────────────────────────────────
//
// Header anatomy (the `### ${heading} (${time}) ` prefix is load-bearing —
// the SessionStart tail regexes above key off it, so date / turn-range /
// markers are appended only as suffix fields):
//
//   ### Session (11:02) [7c1e0d5a-…-4f2b] · 2026-06-03 · ~/Oppi · turns 9–15 · claude: claude-opus-5 · ↩ continues 2026-06-01
//
// The turn range makes every block self-describing — capture and compile
// can reconstruct the whole session index from headers alone.

/** En-dash used in `turns FROM–TO`. Kept as a constant so writer and parser stay in lockstep. */
const TURN_DASH = '–';

export interface EntryHeaderFields {
  /** 'Session' | 'Pre-Compact' */
  heading: string;
  /** HH:MM */
  time: string;
  /** the harness's full session id */
  sessionId: string;
  /** YYYY-MM-DD this block was written */
  date: string;
  /** home-relative cwd */
  source: string;
  /** first turn number in this block (1-based, inclusive) */
  from: number;
  /** last turn number in this block (inclusive) */
  to: number;
  /** harness whose transcript this came from — the capture format name (claude, codex) */
  harness: string;
  /** model(s) that produced the block's assistant turns, comma-separated; empty when the transcript doesn't say */
  model?: string;
  /** when set, this block continues a session first seen on this earlier date */
  continues?: string;
  /** when true, the cursor was re-anchored after a transcript rewrite */
  reanchored?: boolean;
}

/** Render an entry header line (no trailing newline). */
export function formatEntryHeader(fields: EntryHeaderFields): string {
  const parts = [
    `### ${fields.heading} (${fields.time}) [${fields.sessionId}]`,
    fields.date,
    fields.source,
    `turns ${fields.from}${TURN_DASH}${fields.to}`
  ];
  parts.push(fields.model ? `${fields.harness}: ${fields.model}` : fields.harness);
  if (fields.continues) parts.push(`↩ continues ${fields.continues}`);
  if (fields.reanchored) parts.push('⚠ re-anchored');
  return parts.join(' · ');
}

/** One parsed header — the subset needed to rebuild the session index. */
export interface ParsedEntryHeader {
  heading: string;
  sessionId: string;
  date: string;
  source: string;
  from: number;
  to: number;
}

const PARSE_HEADER_RE = new RegExp(
  `^### (Session|Pre-Compact) \\(\\d{2}:\\d{2}\\) \\[([0-9a-fA-F-]+)\\] · (\\d{4}-\\d{2}-\\d{2}) · (.+?) · turns (\\d+)${TURN_DASH}(\\d+)`,
  'gm'
);

/**
 * Extract every parseable entry header from a day-file's content. Headers that
 * predate the turn-range format (no `· turns N–M`) are skipped — they can't be
 * placed on the cursor timeline and the index treats their sessions as absent.
 */
export function parseEntryHeaders(content: string): ParsedEntryHeader[] {
  const out: ParsedEntryHeader[] = [];
  for (const match of content.matchAll(PARSE_HEADER_RE)) {
    out.push({
      heading: match[1],
      sessionId: match[2],
      date: match[3],
      source: match[4],
      from: parseInt(match[5], 10),
      to: parseInt(match[6], 10)
    });
  }
  return out;
}

// The heartbeat's own runs: a look (`<plugin>:proposals`) and a brain refresh (`<plugin>:sync` with `brain`). What
// they write lands through those runs; their transcripts carry nothing the brain needs.
const HEARTBEAT_COMMAND = /^<command-message>[\w-]+:(proposals|sync)<\/command-message>/;
const SKILL_BODY = /^Base directory for this skill:/;
// The host's note before a local command such as /clear: alone in a turn, it says nothing.
const CAVEAT_ONLY = /^<local-command-caveat>[\s\S]*<\/local-command-caveat>\s*$/;

const isHeartbeatCommand = (text: string): boolean => {
  const match = HEARTBEAT_COMMAND.exec(text);
  return match !== null && (match[1] === 'proposals' || /<command-args>\s*brain\s*<\/command-args>/.test(text));
};

/**
 * Turns without the heartbeat's exchanges: a look or brain refresh it ran, the skill body that came with it, and
 * every reply until the operator spoke again. A turn that is only the host's local-command note goes too.
 */
export const dropHeartbeatTurns = <Turn extends { role: string; text: string }>(turns: readonly Turn[]): Turn[] =>
  turns.reduce<{ kept: Turn[]; inHeartbeat: boolean }>(
    ({ kept, inHeartbeat }, turn) => {
      if (turn.role !== 'user') {
        return { kept: inHeartbeat ? kept : [...kept, turn], inHeartbeat };
      }
      if (CAVEAT_ONLY.test(turn.text)) {
        return { kept, inHeartbeat };
      }
      if (isHeartbeatCommand(turn.text) || (inHeartbeat && SKILL_BODY.test(turn.text))) {
        return { kept, inHeartbeat: true };
      }
      return { kept: [...kept, turn], inHeartbeat: false };
    },
    { kept: [], inHeartbeat: false }
  ).kept;

const TURN_SPLIT_RE = new RegExp(String.raw`\n\n(?=${TURN_MARKER})`);
const ROLE_RE = /^\*\*(User|Assistant):\*\* ?/;

/**
 * Session-log text without the heartbeat's exchanges: each entry keeps its header and its other turns, and an entry
 * left with no turn is dropped whole.
 */
export const withoutHeartbeat = (text: string): string =>
  text
    .split(ENTRY_SPLIT_RE)
    .map((entry) => {
      const separator = TRAILING_SEPARATOR_RE.exec(entry)?.[0] ?? '';
      const [first = '', ...rest] = entry.slice(0, entry.length - separator.length).split(TURN_SPLIT_RE);
      // A chunk cut mid-entry starts on a turn, with no header before it.
      const [head, pieces] = ROLE_RE.test(first) ? ['', [first, ...rest]] : [first, rest];
      const turns = pieces.map((piece) => ({
        piece,
        role: ROLE_RE.exec(piece)?.[1] === 'User' ? 'user' : 'assistant',
        text: piece.replace(ROLE_RE, '')
      }));
      if (turns.length === 0) {
        return entry;
      }
      const kept = dropHeartbeatTurns(turns);
      return kept.length === 0
        ? ''
        : `${[head, ...kept.map(({ piece }) => piece)].filter(Boolean).join('\n\n')}${separator}`;
    })
    .join('');
