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

const DECISION = `(${CHOICES.join('|')})\\s+(\\S+)(?:\\s+${WORKSPACE_FLAG}(\\S+))?`;
const DECISION_ALONE = new RegExp(`^${DECISION}$`);

/**
 * A `/proposal` decision typed after whatever was half-written in the prompt, as a sidebar button types it.
 */
export const DECISION_AT_END = new RegExp(`/proposal\\s+${DECISION}\\s*$`);

export interface Decision {
  choice: Choice;
  id: string;
  /** The cmux workspace a Start opens its session in, when the sidebar picked one. */
  workspace?: string;
}

const isChoice = (word: string | undefined): word is Choice => CHOICES.some((choice) => choice === word);

const decisionOf = (match: RegExpExecArray | null): Decision | null => {
  const [, choice, id, workspace] = match ?? [];
  if (!isChoice(choice) || !id) {
    return null;
  }
  return workspace ? { choice, id, workspace } : { choice, id };
};

export const parseDecision = (args: string): Decision | null => decisionOf(DECISION_ALONE.exec(args.trim()));

/**
 * The decision at the end of a submitted prompt, and the draft typed before it.
 */
export const decisionInDraft = (text: string): (Decision & { draft: string }) | null => {
  const match = DECISION_AT_END.exec(text);
  const decision = decisionOf(match);
  return match && decision ? { ...decision, draft: text.slice(0, match.index).trimEnd() } : null;
};

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

export const logged = (log: readonly HeartbeatEvent[], event: HeartbeatEvent): HeartbeatEvent[] =>
  [event, ...log].slice(0, LOG_SIZE);

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
 * When the next look is due; late once the clock is a minute past it, as after the Mac slept through it.
 */
export const nextLook = (nextAt: number, now: number, timeZone: string): string =>
  `next look ${clockIn(nextAt, timeZone)}${now - nextAt > MINUTE_MS ? ' (late)' : ''}`;

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
