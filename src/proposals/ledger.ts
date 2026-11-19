import { FILES } from '@/config';
import { isRecord } from '@/shared/json-block';
import { writeJsonAtomic } from '@/shared/utils';
import { readFileSync } from 'node:fs';
import type { SessionPlace } from './adapter';

const STATES = ['waiting', 'later', 'started', 'skipped'] as const;
type ProposalState = (typeof STATES)[number];

/**
 * A session the agent prepared and is waiting for a yes on.
 */
export interface Proposal {
  id: string;
  /**
   * What it came from, the key that keeps it from being proposed twice (`task:ab-012`, `gh:owner/repo#79`, `sync`).
   */
  source: string;
  title: string;
  /**
   * What happened that made the agent propose it.
   */
  trigger: string;
  /**
   * The source's own words, '' when none help.
   */
  quote: string;
  detail: string;
  /**
   * What the session may touch.
   */
  reach: string;
  /**
   * How long it should take (`5m`).
   */
  estimate: string;
  /**
   * When it presses (`due Sat`), '' when nothing does.
   */
  due: string;
  prompt: string;
  createdAt: string;
  state: ProposalState;
  /**
   * When a proposal put off with Later shows again, an ISO time with an offset; '' otherwise.
   */
  laterUntil: string;
  decidedAt: string;
}

/**
 * The session that keeps proposals coming, by its Claude session id, and the places adapters can reach it.
 */
export interface Heartbeat {
  sessionId: string;
  places: SessionPlace[];
  everyMinutes: number;
}

export interface ProposalLedger {
  heartbeat: Heartbeat | null;
  proposals: Proposal[];
}

export const EMPTY_LEDGER: ProposalLedger = { heartbeat: null, proposals: [] };

const TEXT_FIELDS = [
  'id',
  'source',
  'title',
  'trigger',
  'quote',
  'detail',
  'reach',
  'estimate',
  'due',
  'prompt',
  'createdAt',
  'laterUntil',
  'decidedAt'
] as const;

const isState = (value: unknown): value is ProposalState => STATES.some((state) => state === value);

// A hand-edited entry missing a field is dropped, never half-read: a proposal without its prompt can't be started.
const parseProposal = (data: unknown): Proposal | null => {
  if (!isRecord(data) || !isState(data.state) || !TEXT_FIELDS.every((field) => typeof data[field] === 'string')) {
    return null;
  }
  const text = (field: (typeof TEXT_FIELDS)[number]): string => String(data[field]);
  return {
    id: text('id'),
    source: text('source'),
    title: text('title'),
    trigger: text('trigger'),
    quote: text('quote'),
    detail: text('detail'),
    reach: text('reach'),
    estimate: text('estimate'),
    due: text('due'),
    prompt: text('prompt'),
    createdAt: text('createdAt'),
    laterUntil: text('laterUntil'),
    decidedAt: text('decidedAt'),
    state: data.state
  };
};

const parsePlace = (data: unknown): SessionPlace | null =>
  isRecord(data) &&
  data.adapter === 'cmux' &&
  typeof data.surfaceId === 'string' &&
  typeof data.workspaceId === 'string'
    ? { adapter: 'cmux', surfaceId: data.surfaceId, workspaceId: data.workspaceId }
    : null;

const parseHeartbeat = (data: unknown): Heartbeat | null => {
  if (!isRecord(data) || typeof data.sessionId !== 'string' || typeof data.everyMinutes !== 'number') {
    return null;
  }
  const places = Array.isArray(data.places) ? data.places.map(parsePlace) : [];
  return {
    sessionId: data.sessionId,
    everyMinutes: data.everyMinutes,
    places: places.filter((place): place is SessionPlace => place !== null)
  };
};

export const parseLedger = (data: unknown): ProposalLedger => {
  if (!isRecord(data)) {
    return EMPTY_LEDGER;
  }
  const proposals = Array.isArray(data.proposals) ? data.proposals.map(parseProposal) : [];
  return {
    heartbeat: parseHeartbeat(data.heartbeat),
    proposals: proposals.filter((proposal): proposal is Proposal => proposal !== null)
  };
};

export const readProposalLedger = (): ProposalLedger => {
  try {
    return parseLedger(JSON.parse(readFileSync(FILES.PROPOSALS, 'utf-8')));
  } catch {
    return EMPTY_LEDGER;
  }
};

export const writeProposalLedger = (ledger: ProposalLedger): void => writeJsonAtomic(FILES.PROPOSALS, ledger);
