import type { MessageLedger } from '@/messages/decide';
import { ledgerProblem, readProposalLedger, writeProposalLedger, type Proposal, type ProposalLedger } from './ledger';
import { decide, reopen } from './rules';

export const proposalMessages: MessageLedger<ProposalLedger, Proposal> = {
  problem: ledgerProblem,
  read: readProposalLedger,
  write: writeProposalLedger,
  decide,
  reopen,
  prompt: (proposal) => proposal.prompt
};
