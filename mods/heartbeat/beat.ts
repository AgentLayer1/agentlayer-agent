// Pure helpers for the heartbeat: no engine calls, so tests can run them as they are.

import type { HeartbeatEvent } from '../types';

export const MESSAGE_CHOICES = ['start', 'later', 'dismiss'] as const;
type MessageChoice = (typeof MESSAGE_CHOICES)[number];

export const MINUTE_MS = 60_000;

/**
 * The least time between two brain refreshes the heartbeat tries, the CLI's `REFRESH_EVERY_HOURS`.
 */
export const REFRESH_RETRY_MS = 6 * 60 * MINUTE_MS;

// Named, so a word typed after a decision is never taken for a workspace.
const WORKSPACE_FLAG = '--workspace=';

export interface Decision {
  choice: MessageChoice;
  id: string;
  /** The cmux workspace a Start opens its session in, when the sidebar picked one. */
  workspace?: string;
}

const DECISION = `(${MESSAGE_CHOICES.join('|')})\\s+(\\S+)(?:\\s+${WORKSPACE_FLAG}(\\S+))?`;
const DECISION_ALONE = new RegExp(`^${DECISION}$`);

/**
 * A `/message <start|later|dismiss> <id>` typed after whatever was half-written in the prompt, as a sidebar button
 * types it.
 */
export const MESSAGE_AT_END = new RegExp(`/message\\s+${DECISION}\\s*$`);

const decisionOf = (match: RegExpExecArray | null): Decision | null => {
  const [, word, id, workspace] = match ?? [];
  const choice = MESSAGE_CHOICES.find((item) => item === word);
  if (!choice || !id) {
    return null;
  }
  return workspace ? { choice, id, workspace } : { choice, id };
};

export const parseDecision = (args: string): Decision | null => decisionOf(DECISION_ALONE.exec(args.trim()));

/**
 * The decision at the end of a submitted prompt, and the draft typed before it.
 */
export const decisionInDraft = (text: string): (Decision & { draft: string }) | null => {
  const match = MESSAGE_AT_END.exec(text);
  const found = decisionOf(match);
  return match && found ? { ...found, draft: text.slice(0, match.index).trimEnd() } : null;
};

type HeartbeatAsk = { kind: 'bind'; every: string } | { kind: 'off' } | { kind: 'now' } | { kind: 'status' };

export const parseAsk = (args: string): HeartbeatAsk => {
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
 * What `heartbeat status --json` prints, as far as the mod reads it.
 */
export interface HeartbeatStatus {
  heartbeat: { owner: string; everyMinutes: number } | null;
  /** The home's timezone, which the day's first wake is read in. */
  timezone: string;
  /** When a sync or brain refresh last ran, an ISO time or ''; and whether the heartbeat should refresh now. */
  refreshedAt: string;
  refreshDue: boolean;
  /** How many proposals show, and the most that do. */
  proposals: { target: number; showing: number };
  /** How many notes may still go out today. */
  notes: { room: number };
}

export const parseStatus = (stdout: string): HeartbeatStatus | null => {
  try {
    const data = record(JSON.parse(stdout));
    const { target, showing } = record(data.proposals);
    const beat = record(data.heartbeat);
    const notesRoom = record(data.notes).room;
    if (typeof data.timezone !== 'string' || typeof target !== 'number' || typeof showing !== 'number') {
      return null;
    }
    return {
      heartbeat:
        typeof beat.owner === 'string' && typeof beat.everyMinutes === 'number'
          ? { owner: beat.owner, everyMinutes: beat.everyMinutes }
          : null,
      timezone: data.timezone,
      refreshedAt: text(data.refreshedAt),
      refreshDue: data.refreshDue === true,
      proposals: { target, showing },
      notes: { room: typeof notesRoom === 'number' ? notesRoom : 0 }
    };
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
    return event.sent ? { mark: '✎', color: 'magenta', text: event.text } : { mark: '·', text: event.text };
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

export interface SentNote {
  id: string;
  title: string;
  body: string;
  next: string;
  sources: string[];
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
      return id ? [note] : [];
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
    `/message start ${note.id} · /message later ${note.id} · /message dismiss ${note.id}`
  ].join('\n');
