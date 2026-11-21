// Pure helpers for the proposals feature: no engine calls, so tests can run them as they are.

export const CHOICES = ['start', 'later', 'skip'] as const;
type Choice = (typeof CHOICES)[number];

export const MINUTE_MS = 60_000;

/**
 * A `/proposal` decision typed after whatever was half-written in the prompt, as a sidebar button types it.
 */
export const DECISION_AT_END = new RegExp(`/proposal\\s+(${CHOICES.join('|')})\\s+(\\S+)\\s*$`);

export interface Decision {
  choice: Choice;
  id: string;
}

const isChoice = (word: string | undefined): word is Choice => CHOICES.some((choice) => choice === word);

export const parseDecision = (args: string): Decision | null => {
  const [choice, id, ...rest] = args.trim().split(/\s+/);
  return isChoice(choice) && id && rest.length === 0 ? { choice, id } : null;
};

/**
 * The decision at the end of a submitted prompt, and the draft typed before it.
 */
export const decisionInDraft = (text: string): (Decision & { draft: string }) | null => {
  const match = DECISION_AT_END.exec(text);
  const choice = match?.[1];
  const id = match?.[2];
  return match && isChoice(choice) && id ? { choice, id, draft: text.slice(0, match.index).trimEnd() } : null;
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

/**
 * How many of the heartbeat's latest ticks its band keeps.
 */
export const LOG_SIZE = 3;

/**
 * One tick of the heartbeat as its band shows it: when, and what came of it.
 */
export interface BeatEvent {
  at: number;
  text: string;
}

export const logged = (log: readonly BeatEvent[], event: BeatEvent): BeatEvent[] => [event, ...log].slice(0, LOG_SIZE);

/**
 * A clock time, 24-hour, in the home's timezone.
 */
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
