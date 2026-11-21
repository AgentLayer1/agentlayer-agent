import { localISO, nowISO, nowTime, shiftDate, todayDate } from '@/shared/date';
import type { SessionPlace } from './adapter';
import type { Proposal, ProposalLedger } from './ledger';
import { isShown, type Choice } from './shown';

/**
 * How many proposals the heartbeat keeps showing.
 */
export const TARGET = 5;
/**
 * The most proposals waiting at once, those put off included; more are refused.
 */
export const BACKLOG = 20;
/**
 * The heartbeat's interval when none is set: inside the prompt cache's hour, so a wake reads the cache.
 */
export const DEFAULT_EVERY_MINUTES = 55;
/**
 * How long the brain may go without a sync or a refresh before the heartbeat refreshes it.
 */
export const REFRESH_EVERY_HOURS = 6;
const EVERY_RANGE = { min: 5, max: 24 * 60 } as const;
const LATER_HOUR = '08:00';

const DAY_MS = 24 * 60 * 60 * 1000;
// A source started within a day, or skipped within a week, isn't proposed again.
const STARTED_QUIET_MS = DAY_MS;
const SKIPPED_QUIET_MS = 7 * DAY_MS;
// Decided proposals older than this are dropped, once no rule above can read them.
const KEEP_DECIDED_MS = 30 * DAY_MS;

export type ProposalInput = Pick<
  Proposal,
  'source' | 'title' | 'trigger' | 'quote' | 'detail' | 'reach' | 'estimate' | 'due' | 'prompt'
> &
  Partial<Pick<Proposal, 'folder' | 'workspace'>>;

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

const isWaiting = (proposal: Proposal): boolean => proposal.state === 'waiting';

const randomId = (): string => `p-${Math.random().toString(36).slice(2, 6)}`;

const freshId = (taken: ReadonlySet<string>, makeId: () => string): string => {
  const id = makeId();
  return taken.has(id) ? freshId(taken, makeId) : id;
};

// Why a source can't be proposed now, or '' when it can.
const blockedBy = (proposals: readonly Proposal[], source: string, nowMs: number): string => {
  const same = proposals.filter((proposal) => proposal.source === source);
  if (same.some(isWaiting)) {
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
  proposals.filter((proposal) => isWaiting(proposal) || nowMs - ms(proposal.decidedAt) < KEEP_DECIDED_MS);

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
        (proposals.filter(isWaiting).length >= BACKLOG ? `${BACKLOG} are already waiting` : '');
      if (reason) {
        return { ...result, refused: [...result.refused, { source: input.source, title: input.title, reason }] };
      }
      const proposal: Proposal = {
        ...input,
        folder: input.folder ?? '',
        workspace: input.workspace ?? '',
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

interface Retiring {
  id: string;
  reason: string;
}

interface Retired {
  ledger: ProposalLedger;
  retired: { id: string; title: string; reason: string }[];
  refused: { id: string; reason: string }[];
}

// Why a proposal can't be retired, or '' when it can.
const keptBy = (proposal: Proposal | undefined, nowMs: number): string => {
  if (!proposal) {
    return 'no such proposal';
  }
  if (!isWaiting(proposal)) {
    return `already ${proposal.state}`;
  }
  return isShown(proposal.laterUntil, nowMs) ? '' : 'put off by the operator';
};

/**
 * Withdraws showing proposals the agent no longer stands behind: outranked, already taken up by a session, or no longer
 * true. One put off with Later waits for the operator, and one already decided is theirs, so both are refused.
 */
export const retireProposals = (ledger: ProposalLedger, retiring: readonly Retiring[], now: Date): Retired => {
  const nowMs = now.getTime();
  return retiring.reduce<Retired>(
    (result, { id, reason }) => {
      const found = result.ledger.proposals.find((proposal) => proposal.id === id);
      const why = keptBy(found, nowMs);
      if (!found || why) {
        return { ...result, refused: [...result.refused, { id, reason: why }] };
      }
      const retired: Proposal = { ...found, state: 'retired', decidedAt: nowISO(now) };
      return {
        ledger: {
          ...result.ledger,
          proposals: result.ledger.proposals.map((proposal) => (proposal.id === id ? retired : proposal))
        },
        retired: [...result.retired, { id, title: found.title, reason }],
        refused: result.refused
      };
    },
    { ledger, retired: [], refused: [] }
  );
};

/**
 * The next 08:00 in the home's timezone, as an ISO time with that day's offset.
 */
export const nextMorning = (now: Date): string => {
  const today = todayDate(now);
  return localISO(nowTime(now) < LATER_HOUR ? today : shiftDate(today, 1), LATER_HOUR);
};

type Decision =
  | { outcome: 'decided'; ledger: ProposalLedger; proposal: Proposal }
  | { outcome: 'unknown' }
  | { outcome: 'already'; proposal: Proposal };

// Later leaves a proposal waiting, with the time it shows again.
const STATE_OF: Record<Choice, Proposal['state']> = { start: 'started', later: 'waiting', skip: 'skipped' };

/**
 * Records the operator's choice. Start and Skip are final: a second Start changes nothing, so a double click can't
 * open two sessions. Later can be chosen again.
 */
export const decide = (ledger: ProposalLedger, id: string, choice: Choice, now: Date): Decision => {
  const found = ledger.proposals.find((proposal) => proposal.id === id);
  if (!found) {
    return { outcome: 'unknown' };
  }
  if (!isWaiting(found)) {
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
  ledger.proposals
    .filter(isWaiting)
    .map(({ id, title, trigger, quote, detail, reach, estimate, due, laterUntil, folder, workspace }) => ({
      id,
      title,
      trigger,
      quote,
      detail,
      reach,
      estimate,
      due,
      laterUntil,
      folder,
      workspace
    }));

export const showingNow = (ledger: ProposalLedger, now: Date): ProposalCard[] =>
  proposalCards(ledger).filter((card) => isShown(card.laterUntil, now.getTime()));

/**
 * How many proposals can be added now: enough to show five, and never past the backlog, which counts the ones put off.
 */
export const roomFor = (ledger: ProposalLedger, now: Date): number =>
  Math.max(0, Math.min(TARGET - showingNow(ledger, now).length, BACKLOG - ledger.proposals.filter(isWaiting).length));

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

/**
 * The later of the last full sync and the last brain refresh, as an ISO time; '' when neither ever ran.
 */
export const lastRefreshed = (syncedAt: string | undefined, refreshedAt: string | undefined): string =>
  [syncedAt ?? '', refreshedAt ?? ''].filter(Boolean).sort((a, b) => ms(a) - ms(b)).at(-1) ?? '';

/**
 * Whether the heartbeat should refresh the brain: nothing has synced or refreshed it in the last `REFRESH_EVERY_HOURS`.
 */
export const refreshDue = (lastAt: string, now: Date): boolean =>
  !lastAt || now.getTime() - ms(lastAt) >= REFRESH_EVERY_HOURS * 60 * 60 * 1000;

export const setHeartbeat = (
  ledger: ProposalLedger,
  owner: string,
  places: readonly SessionPlace[],
  everyMinutes: number
): ProposalLedger => ({ ...ledger, heartbeat: { owner, places: [...places], everyMinutes } });

export const clearHeartbeat = (ledger: ProposalLedger): ProposalLedger => ({ ...ledger, heartbeat: null });

/**
 * Clears the heartbeat only while `owner` still holds it, so a session that exits never clears a newer one.
 */
export const releaseHeartbeat = (ledger: ProposalLedger, owner: string): ProposalLedger =>
  ledger.heartbeat?.owner === owner ? clearHeartbeat(ledger) : ledger;
