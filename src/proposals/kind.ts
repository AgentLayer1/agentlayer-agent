import type { MessageKind } from '@/messages/decide';
import { ledgerProblem, readProposalLedger, writeProposalLedger, type Proposal, type ProposalLedger } from './ledger';
import { decide, reopen } from './rules';

export const proposalMessages: MessageKind<ProposalLedger, Proposal> = {
  noun: 'proposal',
  problem: ledgerProblem,
  read: readProposalLedger,
  write: writeProposalLedger,
  has: (ledger, id) => ledger.proposals.some((proposal) => proposal.id === id),
  decide,
  reopen,
  prompt: (proposal) => proposal.prompt
};
