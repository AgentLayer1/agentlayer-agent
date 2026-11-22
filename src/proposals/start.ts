import { startPrompt, type StartContext } from '@/sessions/launch';
import { log } from '@/shared/log';
import type { ProposalAdapter } from './adapter';
import { ledgerProblem, readProposalLedger, writeProposalLedger } from './ledger';
import { decide, reopen } from './rules';
import type { Choice } from './shown';

/**
 * Redraws every adapter's view of the proposals; one that fails is logged and the rest still draw.
 */
export const publishTo = (adapters: readonly ProposalAdapter[], home: string): void =>
  adapters.forEach((adapter) => {
    try {
      adapter.publish(home);
    } catch (error) {
      log
        .with('proposals')
        .warn(`${adapter.name} didn't redraw: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

export interface DecideContext extends StartContext {
  adapters: readonly ProposalAdapter[];
}

/**
 * Applies the operator's choice and says what happened. Start marks the proposal started before opening anything, so a
 * repeat can't open a second session, and puts it back if the session couldn't open.
 */
export const decideProposal = (id: string, choice: Choice, context: DecideContext): string => {
  const problem = ledgerProblem();
  if (problem) {
    return problem;
  }
  const decision = decide(readProposalLedger(), id, choice, context.now);
  if (decision.outcome === 'unknown') {
    return `No proposal ${id}.`;
  }
  if (decision.outcome === 'already') {
    return `${decision.proposal.title}: already ${decision.proposal.state}.`;
  }
  const { proposal } = decision;
  if (choice !== 'start') {
    writeProposalLedger(decision.ledger);
    publishTo(context.adapters, context.home);
    return choice === 'later' ? `Later: ${proposal.title} comes back in the morning.` : `Skipped: ${proposal.title}.`;
  }
  writeProposalLedger(decision.ledger);
  const opened = startPrompt(proposal, context);
  if ('error' in opened) {
    writeProposalLedger(reopen(readProposalLedger(), proposal.id));
  }
  publishTo(context.adapters, context.home);
  return 'error' in opened
    ? `Couldn't start ${proposal.title}: ${opened.error}`
    : `Started: ${proposal.title}. ${opened.where}`;
};
