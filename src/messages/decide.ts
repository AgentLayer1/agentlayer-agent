import { startPrompt, type StartContext } from '@/sessions/launch';
import type { Decision, MessageChoice } from './choices';

interface Message {
  id: string;
  title: string;
  state: string;
}

/**
 * What the flow needs from a kind of message: its ledger (what's wrong with it, read, write), the choice applied, how to
 * put a started one back, and the first message of the session its Start opens.
 */
export interface MessageLedger<Ledger, Item extends Message> {
  problem: () => string;
  read: () => Ledger;
  write: (ledger: Ledger) => void;
  decide: (ledger: Ledger, id: string, choice: MessageChoice, now: Date) => Decision<Ledger, Item>;
  reopen: (ledger: Ledger, id: string) => Ledger;
  prompt: (item: Item) => string;
}

/**
 * Applies the operator's choice on a message and says what happened, or null when this kind holds no such id. Start
 * marks it started before opening anything, so a repeat can't open a second session, and puts it back if the session
 * couldn't open.
 */
export const decideMessage = <Ledger, Item extends Message>(
  kind: MessageLedger<Ledger, Item>,
  id: string,
  choice: MessageChoice,
  context: StartContext
): string | null => {
  const problem = kind.problem();
  if (problem) {
    return problem;
  }
  const decision = kind.decide(kind.read(), id, choice, context.now);
  if (decision.outcome === 'unknown') {
    return null;
  }
  if (decision.outcome === 'already') {
    return `${decision.item.title}: already ${decision.item.state}.`;
  }
  const { item } = decision;
  kind.write(decision.ledger);
  if (choice !== 'start') {
    return choice === 'later' ? `Later: ${item.title} comes back in the morning.` : `Dismissed: ${item.title}.`;
  }
  const opened = startPrompt({ id, prompt: kind.prompt(item) }, context);
  if ('error' in opened) {
    kind.write(kind.reopen(kind.read(), id));
    return `Couldn't start ${item.title}: ${opened.error}`;
  }
  return `Started: ${item.title}. ${opened.where}`;
};
