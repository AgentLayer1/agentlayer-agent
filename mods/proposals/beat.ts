// Pure helpers for the proposals feature: no engine calls, so tests can run them as they are.

const CHOICES = ['start', 'later', 'skip'] as const;
type Choice = (typeof CHOICES)[number];

const QUIET = { from: 23, to: 7 } as const;

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

const hourIn = (epochMs: number, timeZone: string | undefined): number =>
  Number(new Date(epochMs).toLocaleString('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }));

export const isQuiet = (epochMs: number, timeZone: string | undefined): boolean => {
  const hour = hourIn(epochMs, timeZone);
  return hour >= QUIET.from || hour < QUIET.to;
};

export const QUIET_HOURS = `${QUIET.from}:00–0${QUIET.to}:00`;

export const dayIn = (epochMs: number, timeZone: string | undefined): string =>
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
  /** The home's timezone, which quiet hours and the day's first wake are read in. */
  timezone: string;
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
      ? { target, room, showing, heartbeat: beat, timezone }
      : null;
  } catch {
    return null;
  }
};
