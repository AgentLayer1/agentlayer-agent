import { FILES } from '@/config';
import { isRecord } from '@/shared/json-block';
import { jsonProblem, writeJsonChecked } from '@/shared/utils';
import { readFileSync } from 'node:fs';

// Retired: the agent withdrew it, outranked, taken up by a session already, or no longer true.
const STATES = ['waiting', 'started', 'skipped', 'retired'] as const;
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
  /**
   * The folder the work lives in (a repo or the home), '' when none was named; it places the session Start opens.
   */
  folder: string;
  /**
   * The title of the workspace the agent picked for it, '' when none; a hint the surface resolves when Start is pressed.
   */
  workspace: string;
  createdAt: string;
  state: ProposalState;
  /**
   * When a waiting proposal put off with Later shows again, an ISO time with an offset; '' when it shows now.
   */
  laterUntil: string;
  decidedAt: string;
}

export interface ProposalLedger {
  proposals: Proposal[];
}

export const EMPTY_LEDGER: ProposalLedger = { proposals: [] };

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

// Fields added after the first ledgers were written read as '' when absent, so an older entry is never dropped.
const optional = (value: unknown): string => (typeof value === 'string' ? value : '');

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
    folder: optional(data.folder),
    workspace: optional(data.workspace),
    state: data.state
  };
};

export const parseLedger = (data: unknown): ProposalLedger => {
  if (!isRecord(data)) {
    return EMPTY_LEDGER;
  }
  const proposals = Array.isArray(data.proposals) ? data.proposals.map(parseProposal) : [];
  return { proposals: proposals.filter((proposal): proposal is Proposal => proposal !== null) };
};

export const readProposalLedger = (): ProposalLedger => {
  try {
    return parseLedger(JSON.parse(readFileSync(FILES.PROPOSALS, 'utf-8')));
  } catch {
    return EMPTY_LEDGER;
  }
};

/**
 * What's wrong with the ledger file, or '' when it is missing or reads. A display can still draw the empty ledger
 * `readProposalLedger` gives for it; anything that writes stops.
 */
export const ledgerProblem = (): string => jsonProblem(FILES.PROPOSALS);

export const writeProposalLedger = (ledger: ProposalLedger): void => writeJsonChecked(FILES.PROPOSALS, ledger);
