import { TIMEZONE } from '@/config';
import { nowISO, offsetFor, shiftDate, todayDate } from '@/shared/date';
import type { SessionPlace } from './adapter';
import type { Proposal, ProposalLedger } from './ledger';
import { isShown } from './shown';

/**
 * How many proposals the heartbeat keeps waiting.
 */
export const TARGET = 5;
/**
 * The most proposals waiting or put off at once; more are refused.
 */
export const BACKLOG = 20;
/**
 * The heartbeat's interval when none is set: inside the prompt cache's hour, so a wake reads the cache.
 */
export const DEFAULT_EVERY_MINUTES = 55;
const EVERY_RANGE = { min: 5, max: 24 * 60 } as const;
const LATER_HOUR = '08:00';

const DAY_MS = 24 * 60 * 60 * 1000;
// A source started within a day, or skipped within a week, isn't proposed again.
const STARTED_QUIET_MS = DAY_MS;
const SKIPPED_QUIET_MS = 7 * DAY_MS;
// Decided proposals older than this are dropped, once no rule above can read them.
const KEEP_DECIDED_MS = 30 * DAY_MS;

export const CHOICES = ['start', 'later', 'skip'] as const;
export type Choice = (typeof CHOICES)[number];

export type ProposalInput = Pick<
  Proposal,
  'source' | 'title' | 'trigger' | 'quote' | 'detail' | 'reach' | 'estimate' | 'due' | 'prompt'
>;

interface Refusal {
  source: string;
  title: string;
  reason: string;
}

/**
 * What a surface shows of a proposal: never its prompt.
 */
export type ProposalCard = Omit<Proposal, 'prompt' | 'state' | 'createdAt' | 'decidedAt' | 'source'>;

const ms = (iso: string): number => Date.parse(iso) || 0;

const isOpen = (proposal: Proposal): boolean => proposal.state === 'waiting' || proposal.state === 'later';

const randomId = (): string => `p-${Math.random().toString(36).slice(2, 6)}`;

const freshId = (taken: ReadonlySet<string>, makeId: () => string): string => {
  const id = makeId();
  return taken.has(id) ? freshId(taken, makeId) : id;
};

// Why a source can't be proposed now, or '' when it can.
const blockedBy = (proposals: readonly Proposal[], source: string, nowMs: number): string => {
  const same = proposals.filter((proposal) => proposal.source === source);
  if (same.some(isOpen)) {
    return 'already proposed';
  }
  if (same.some((proposal) => proposal.state === 'started' && nowMs - ms(proposal.decidedAt) < STARTED_QUIET_MS)) {
    return 'started in the last day';
  }
  if (same.some((proposal) => proposal.state === 'skipped' && nowMs - ms(proposal.decidedAt) < SKIPPED_QUIET_MS)) {
    return 'skipped in the last week';
  }
  return '';
};

const prune = (proposals: readonly Proposal[], nowMs: number): Proposal[] =>
  proposals.filter((proposal) => isOpen(proposal) || nowMs - ms(proposal.decidedAt) < KEEP_DECIDED_MS);

interface Added {
  ledger: ProposalLedger;
  added: Proposal[];
  refused: Refusal[];
}

/**
 * Adds each input that isn't blocked by its source or by the backlog, in order.
 */
export const addProposals = (
  ledger: ProposalLedger,
  inputs: readonly ProposalInput[],
  now: Date,
  makeId: () => string = randomId
): Added => {
  const nowMs = now.getTime();
  return inputs.reduce<Added>(
    (result, input) => {
      const { proposals } = result.ledger;
      const reason =
        blockedBy(proposals, input.source, nowMs) ||
        (proposals.filter(isOpen).length >= BACKLOG ? `${BACKLOG} are already waiting` : '');
      if (reason) {
        return { ...result, refused: [...result.refused, { source: input.source, title: input.title, reason }] };
      }
      const proposal: Proposal = {
        ...input,
        id: freshId(new Set(proposals.map(({ id }) => id)), makeId),
        createdAt: nowISO(now),
        state: 'waiting',
        laterUntil: '',
        decidedAt: ''
      };
      return {
        ...result,
        ledger: { ...result.ledger, proposals: [...proposals, proposal] },
        added: [...result.added, proposal]
      };
    },
    { ledger: { ...ledger, proposals: prune(ledger.proposals, nowMs) }, added: [], refused: [] }
  );
};

export const removeProposals = (ledger: ProposalLedger, ids: readonly string[]): ProposalLedger => ({
  ...ledger,
  proposals: ledger.proposals.filter(({ id }) => !ids.includes(id))
});

/**
 * The next 08:00 in the home's timezone, as an ISO time with that day's offset.
 */
export const nextMorning = (now: Date): string => {
  const today = todayDate(now);
  const hour = Number(now.toLocaleString('en-GB', { timeZone: TIMEZONE, hour: '2-digit', hourCycle: 'h23' }));
  const day = hour < Number(LATER_HOUR.slice(0, 2)) ? today : shiftDate(today, 1);
  const local = `${day}T${LATER_HOUR}:00`;
  // Read twice: the first offset, taken at 08:00 UTC, can sit on the other side of a DST change.
  const guess = offsetFor(new Date(`${local}Z`));
  return `${local}${offsetFor(new Date(`${local}${guess}`))}`;
};

type Decision =
  | { outcome: 'decided'; ledger: ProposalLedger; proposal: Proposal }
  | { outcome: 'unknown' }
  | { outcome: 'already'; proposal: Proposal };

const STATE_OF: Record<Choice, Proposal['state']> = { start: 'started', later: 'later', skip: 'skipped' };

/**
 * Records the operator's choice. A proposal is decided once: a second Start on it changes nothing, so a double click
 * can't open two sessions.
 */
export const decide = (ledger: ProposalLedger, id: string, choice: Choice, now: Date): Decision => {
  const found = ledger.proposals.find((proposal) => proposal.id === id);
  if (!found) {
    return { outcome: 'unknown' };
  }
  if (!isOpen(found)) {
    return { outcome: 'already', proposal: found };
  }
  const proposal: Proposal = {
    ...found,
    state: STATE_OF[choice],
    laterUntil: choice === 'later' ? nextMorning(now) : '',
    decidedAt: nowISO(now)
  };
  return {
    outcome: 'decided',
    ledger: { ...ledger, proposals: ledger.proposals.map((item) => (item.id === id ? proposal : item)) },
    proposal
  };
};

/**
 * Puts a proposal back to waiting, for a Start whose session couldn't open.
 */
export const reopen = (ledger: ProposalLedger, id: string): ProposalLedger => ({
  ...ledger,
  proposals: ledger.proposals.map((proposal) =>
    proposal.id === id ? { ...proposal, state: 'waiting', laterUntil: '', decidedAt: '' } : proposal
  )
});

/**
 * Every proposal still to decide, oldest first, as a surface draws it; a surface filters out the ones put off with
 * `isShown` against its own clock.
 */
export const proposalCards = (ledger: ProposalLedger): ProposalCard[] =>
  ledger.proposals.filter(isOpen).map(({ id, title, trigger, quote, detail, reach, estimate, due, laterUntil }) => ({
    id,
    title,
    trigger,
    quote,
    detail,
    reach,
    estimate,
    due,
    laterUntil
  }));

export const waitingNow = (ledger: ProposalLedger, now: Date): ProposalCard[] =>
  proposalCards(ledger).filter((card) => isShown(card.laterUntil, now.getTime()));

const DURATION = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i;

/**
 * Minutes from `15m`, `15 mins`, `1h` or `90 minutes`, within 5 minutes and a day; an error saying why otherwise.
 */
export const parseEvery = (text: string): number | Error => {
  const match = DURATION.exec(text.trim());
  if (!match) {
    return new Error(`"${text}" isn't a duration like 15m, 15 mins, 1h or 90 minutes.`);
  }
  const amount = Number(match[1]);
  const minutes = /^h/i.test(match[2] ?? '') ? amount * 60 : amount;
  return minutes < EVERY_RANGE.min || minutes > EVERY_RANGE.max
    ? new Error(`Pick an interval between ${EVERY_RANGE.min} minutes and 24 hours.`)
    : minutes;
};

export const setHeartbeat = (
  ledger: ProposalLedger,
  sessionId: string,
  places: readonly SessionPlace[],
  everyMinutes: number
): ProposalLedger => ({ ...ledger, heartbeat: { sessionId, places: [...places], everyMinutes } });

export const clearHeartbeat = (ledger: ProposalLedger): ProposalLedger => ({ ...ledger, heartbeat: null });
