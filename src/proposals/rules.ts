import { DAY_MS, isoMs, nextMorning, nowISO } from '@/shared/date';
import { freshId, shortId } from '@/shared/utils';
import type { Proposal, ProposalLedger } from './ledger';
import { isShown, type MessageChoice } from '@/shared/message';

const randomId = shortId('p');

/**
 * How many proposals the heartbeat keeps showing.
 */
export const TARGET = 5;
/**
 * The most proposals waiting at once, those put off included; more are refused.
 */
export const BACKLOG = 20;

// A source started within a day, or dismissed within a week, isn't proposed again.
const STARTED_QUIET_MS = DAY_MS;
const DISMISSED_QUIET_MS = 7 * DAY_MS;
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
export type ProposalCard = Omit<Proposal, 'prompt' | 'state' | 'createdAt' | 'decidedAt' | 'source'> & { at: string };

const isWaiting = (proposal: Proposal): boolean => proposal.state === 'waiting';

// Why a source can't be proposed now, or '' when it can.
const blockedBy = (proposals: readonly Proposal[], source: string, nowMs: number): string => {
  const same = proposals.filter((proposal) => proposal.source === source);
  if (same.some(isWaiting)) {
    return 'already proposed';
  }
  if (same.some((proposal) => proposal.state === 'started' && nowMs - isoMs(proposal.decidedAt) < STARTED_QUIET_MS)) {
    return 'started in the last day';
  }
  if (same.some((proposal) => proposal.state === 'dismissed' && nowMs - isoMs(proposal.decidedAt) < DISMISSED_QUIET_MS)) {
    return 'dismissed in the last week';
  }
  return '';
};

const prune = (proposals: readonly Proposal[], nowMs: number): Proposal[] =>
  proposals.filter((proposal) => isWaiting(proposal) || nowMs - isoMs(proposal.decidedAt) < KEEP_DECIDED_MS);

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
  /**
   * The source of the new proposal it makes way for, when it is retired only for that one.
   */
  for?: string | undefined;
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

interface Swapped extends Added {
  retired: Retired['retired'];
  kept: Retired['refused'];
}

/**
 * Retires, then adds, as one change to the ledger. A card retired to make way for a proposal that was refused is put
 * back as it was, so a swap never only shrinks the list.
 */
export const swapProposals = (
  ledger: ProposalLedger,
  inputs: readonly ProposalInput[],
  retiring: readonly Retiring[],
  now: Date,
  makeId: () => string = randomId
): Swapped => {
  const withdrawn = retireProposals(ledger, retiring, now);
  const grown = addProposals(withdrawn.ledger, inputs, now, makeId);
  const refusedSources = new Set(grown.refused.map(({ source }) => source));
  const putBack = new Set(
    retiring
      .filter((item) => item.for !== undefined && refusedSources.has(item.for))
      .map(({ id }) => id)
      .filter((id) => withdrawn.retired.some((retired) => retired.id === id))
  );
  const before = new Map(ledger.proposals.map((proposal) => [proposal.id, proposal]));
  return {
    ...grown,
    ledger: {
      ...grown.ledger,
      proposals: grown.ledger.proposals.map((proposal) =>
        putBack.has(proposal.id) ? (before.get(proposal.id) ?? proposal) : proposal
      )
    },
    retired: withdrawn.retired.filter(({ id }) => !putBack.has(id)),
    kept: [...withdrawn.refused, ...[...putBack].map((id) => ({ id, reason: 'its replacement was refused' }))]
  };
};

type Decision =
  | { outcome: 'decided'; ledger: ProposalLedger; proposal: Proposal }
  | { outcome: 'unknown' }
  | { outcome: 'already'; proposal: Proposal };

// Later leaves a proposal waiting, with the time it shows again.
const STATE_OF: Record<MessageChoice, Proposal['state']> = { start: 'started', later: 'waiting', dismiss: 'dismissed' };

/**
 * Records the operator's choice. Start and Dismiss are final: a second Start changes nothing, so a double click can't
 * open two sessions. Later can be chosen again.
 */
export const decide = (ledger: ProposalLedger, id: string, choice: MessageChoice, now: Date): Decision => {
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
    .map(({ id, title, trigger, quote, detail, reach, estimate, due, laterUntil, folder, workspace, createdAt }) => ({
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
      workspace,
      at: createdAt
    }));

export const showingNow = (ledger: ProposalLedger, now: Date): ProposalCard[] =>
  proposalCards(ledger).filter((card) => isShown(card.laterUntil, now.getTime()));

/**
 * How many proposals can be added now: enough to show five, and never past the backlog, which counts the ones put off.
 */
export const roomFor = (ledger: ProposalLedger, now: Date): number =>
  Math.max(0, Math.min(TARGET - showingNow(ledger, now).length, BACKLOG - ledger.proposals.filter(isWaiting).length));
