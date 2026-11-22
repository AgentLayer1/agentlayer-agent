// Pure helpers for the proposals feature: no engine calls, so tests can run them as they are.

import type { HeartbeatEvent } from '../types';

export const CHOICES = ['start', 'later', 'skip'] as const;
type Choice = (typeof CHOICES)[number];

export const MINUTE_MS = 60_000;

/**
 * The least time between two brain refreshes the heartbeat tries, the CLI's `REFRESH_EVERY_HOURS`.
 */
export const REFRESH_RETRY_MS = 6 * 60 * MINUTE_MS;

// Named, so a word typed after a decision is never taken for a workspace.
const WORKSPACE_FLAG = '--workspace=';

export interface Decision<C extends string = Choice> {
  choice: C;
  id: string;
  /** The cmux workspace a Start opens its session in, when the sidebar picked one. */
  workspace?: string;
}

export interface DecisionGrammar<C extends string> {
  /** The decision typed after whatever was half-written in the prompt, as a sidebar button types it. */
  atEnd: RegExp;
  parse: (args: string) => Decision<C> | null;
  /** The decision at the end of a submitted prompt, and the draft typed before it. */
  inDraft: (text: string) => (Decision<C> & { draft: string }) | null;
}

// `/<command> <choice> <id> [--workspace=<id>]`.
const decisionGrammar = <C extends string>(command: string, choices: readonly C[]): DecisionGrammar<C> => {
  const decision = `(${choices.join('|')})\\s+(\\S+)(?:\\s+${WORKSPACE_FLAG}(\\S+))?`;
  const alone = new RegExp(`^${decision}$`);
  const atEnd = new RegExp(`/${command}\\s+${decision}\\s*$`);
  const decisionOf = (match: RegExpExecArray | null): Decision<C> | null => {
    const [, word, id, workspace] = match ?? [];
    const choice = choices.find((item) => item === word);
    if (!choice || !id) {
      return null;
    }
    return workspace ? { choice, id, workspace } : { choice, id };
  };
  return {
    atEnd,
    parse: (args) => decisionOf(alone.exec(args.trim())),
    inDraft: (text) => {
      const match = atEnd.exec(text);
      const found = decisionOf(match);
      return match && found ? { ...found, draft: text.slice(0, match.index).trimEnd() } : null;
    }
  };
};

export const PROPOSAL_DECISION = decisionGrammar('proposal', CHOICES);

export const NOTE_CHOICES = ['useful', 'dismiss', 'start'] as const;
export type NoteChoice = (typeof NOTE_CHOICES)[number];
export const NOTE_DECISION = decisionGrammar('note', NOTE_CHOICES);

type HeartbeatAsk = { kind: 'bind'; every: string } | { kind: 'off' } | { kind: 'now' } | { kind: 'status' };

export const parseHeartbeat = (args: string): HeartbeatAsk => {
  const text = args.trim();
  if (text === 'off' || text === 'now' || text === 'status') {
    return { kind: text };
  }
  return { kind: 'bind', every: text };
};

const TRANSCRIPT = '.jsonl';

/**
 * The newest write to a session transcript in a folder listing, leaving out the given sessions; 0 when there is none.
 */
export const lastWrite = (
  entries: readonly { name: string; kind: string; mtimeMs: number }[],
  skip: readonly string[]
): number =>
  Math.max(
    0,
    ...entries
      .filter(({ name, kind }) => kind === 'file' && name.endsWith(TRANSCRIPT) && !skip.includes(name.slice(0, -TRANSCRIPT.length)))
      .map(({ mtimeMs }) => mtimeMs)
  );

export const dayIn = (epochMs: number, timeZone: string): string =>
  new Date(epochMs).toLocaleDateString('sv-SE', { timeZone });

/**
 * What `proposals list --json` prints, as far as the wake reads it.
 */
export interface ProposalList {
  target: number;
  /** How many can be added now; 0 also when put-off proposals fill the backlog. */
  room: number;
  showing: readonly { id: string; title: string }[];
  heartbeat: { owner: string; everyMinutes: number } | null;
  /** The home's timezone, which the day's first wake is read in. */
  timezone: string;
  /** When a sync or brain refresh last ran, an ISO time or ''; and whether the heartbeat should refresh now. */
  refreshedAt: string;
  refreshDue: boolean;
}

export const parseList = (stdout: string): ProposalList | null => {
  try {
    const data: unknown = JSON.parse(stdout);
    if (typeof data !== 'object' || data === null || !('target' in data) || !('showing' in data)) {
      return null;
    }
    const { target, showing } = data;
    const room = 'room' in data ? data.room : undefined;
    const timezone = 'timezone' in data ? data.timezone : undefined;
    const heartbeat = 'heartbeat' in data ? data.heartbeat : null;
    const refreshedAt = 'refreshedAt' in data && typeof data.refreshedAt === 'string' ? data.refreshedAt : '';
    const refreshDue = 'refreshDue' in data && data.refreshDue === true;
    const beat =
      typeof heartbeat === 'object' &&
      heartbeat !== null &&
      'owner' in heartbeat &&
      'everyMinutes' in heartbeat &&
      typeof heartbeat.owner === 'string' &&
      typeof heartbeat.everyMinutes === 'number'
        ? { owner: heartbeat.owner, everyMinutes: heartbeat.everyMinutes }
        : null;
    return typeof target === 'number' &&
      typeof room === 'number' &&
      typeof timezone === 'string' &&
      Array.isArray(showing)
      ? { target, room, showing, heartbeat: beat, timezone, refreshedAt, refreshDue }
      : null;
  } catch {
    return null;
  }
};

const LOG_SIZE = 3;

// A skip that repeats the newest one folds into it, so a quiet night is one line, not the whole log.
export const logged = (log: readonly HeartbeatEvent[], event: HeartbeatEvent): HeartbeatEvent[] => {
  const [newest, ...older] = log;
  if (event.kind === 'skip' && newest?.kind === 'skip' && newest.text === event.text) {
    return [{ ...event, count: (newest.count ?? 1) + 1, since: newest.since ?? newest.at }, ...older];
  }
  return [event, ...log].slice(0, LOG_SIZE);
};

export const clockIn = (epochMs: number, timeZone: string): string =>
  new Date(epochMs).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * The last line of a wake turn's answer, its one-line ending, without markdown emphasis.
 */
export const closingLine = (answer: string): string =>
  answer
    .split('\n')
    .map((line) => line.replace(/[*_`]/g, '').trim())
    .filter(Boolean)
    .at(-1) ?? '';

/**
 * Whether a look is overdue by more than a minute, as when the Mac slept through it.
 */
export const isLate = (nextAt: number, now: number): boolean => now - nextAt > MINUTE_MS;

const span = (minutes: number): string =>
  minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;

/**
 * When the next look comes: a countdown and its clock time, or when it was due once it is late.
 */
export const nextLook = (nextAt: number, now: number, timeZone: string): string => {
  const at = clockIn(nextAt, timeZone);
  if (isLate(nextAt, now)) {
    return `next look was due ${at}`;
  }
  const minutes = Math.ceil((nextAt - now) / MINUTE_MS);
  return minutes <= 1 ? `next look now · ${at}` : `next look in ${span(minutes)} · ${at}`;
};

/**
 * How the band draws one event: its mark, the mark's colour (absent for dim), and its words.
 */
export const eventView = (
  event: HeartbeatEvent,
  timeZone: string
): { mark: string; color?: 'green' | 'cyan' | 'red' | 'magenta'; text: string } => {
  if (event.kind === 'skip') {
    const times = event.count && event.since ? ` ${event.count}× since ${clockIn(event.since, timeZone)}` : '';
    return { mark: '–', text: `skipped${times} · ${event.text}` };
  }
  if (event.kind === 'refresh') {
    return { mark: '↻', color: 'cyan', text: event.text };
  }
  if (event.kind === 'notes') {
    return /^no (note|room)/i.test(event.text) ? { mark: '·', text: event.text } : { mark: '✎', color: 'magenta', text: event.text };
  }
  if (event.kind === 'stopped') {
    return { mark: '✗', color: 'red', text: event.text };
  }
  return /nothing new/i.test(event.text) ? { mark: '·', text: event.text } : { mark: '✓', color: 'green', text: event.text };
};

/**
 * How long ago a time was, in the largest whole unit: just now, 12m, 3h, 2d.
 */
export const ago = (epochMs: number, now: number): string => {
  const minutes = Math.floor((now - epochMs) / MINUTE_MS);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  return minutes < 48 * 60 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / (24 * 60))}d ago`;
};

const WORKSPACE_LINE = /^\s*\*?\s*workspace:\S+\s+(.+?)(?:\s+\[selected\])?\s*$/;
// cmux titles an unnamed workspace by its folder, which names no kind of work.
const PATH_TITLE = /^(\/|~|…\/)/;

/**
 * The workspace titles in `cmux workspace list`'s output, in its order, those that are only a folder left out.
 */
export const workspaceTitles = (stdout: string): string[] =>
  stdout
    .split('\n')
    .map((line) => WORKSPACE_LINE.exec(line)?.[1]?.trim() ?? '')
    .filter((title) => title !== '' && !PATH_TITLE.test(title));

/**
 * The room for notes left today from `notes list --json`; null when it can't be read.
 */
export const notesRoom = (stdout: string): number | null => {
  try {
    const data: unknown = JSON.parse(stdout);
    return typeof data === 'object' && data !== null && 'room' in data && typeof data.room === 'number' ? data.room : null;
  } catch {
    return null;
  }
};

export interface SentNote {
  id: string;
  title: string;
  body: string;
  next: string;
  sources: string[];
  canStart: boolean;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : {};

/**
 * The notes a `note_add` call sent, and how many of the day's cap have gone out; null when its result isn't the tool's
 * JSON.
 */
export const notesSent = (resultText: string): { notes: SentNote[]; today: number; cap: number } | null => {
  try {
    const result = record(JSON.parse(resultText));
    if (!Array.isArray(result.added)) {
      return null;
    }
    const notes = result.added.map(record).flatMap((added): SentNote[] => {
      const id = text(added.id);
      const sources = Array.isArray(added.sources) ? added.sources.map(text).filter(Boolean) : [];
      const note = { id, title: text(added.title), body: text(added.body), next: text(added.next), sources };
      return id ? [{ ...note, canStart: added.canStart === true }] : [];
    });
    const count = (value: unknown): number => (typeof value === 'number' ? value : 0);
    return { notes, today: count(result.today), cap: count(result.cap) };
  } catch {
    return null;
  }
};

/**
 * A note as a notice row in the transcript: kept in the scrollback, never read by the model.
 */
export const noticeText = (note: SentNote): string =>
  [
    `📝 ${note.title}`,
    note.body,
    `Next: ${note.next}`,
    ...note.sources.map((url) => `· ${url}`),
    `${note.canStart ? `/note start ${note.id} · ` : ''}/note useful ${note.id} · /note dismiss ${note.id}`
  ].join('\n');
