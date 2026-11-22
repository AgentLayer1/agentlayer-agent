import { FOLDERS, homeLauncher } from '@/config';
import { log } from '@/shared/log';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promptLaunch, type ProposalAdapter, type SessionPlace, type StartInput } from './adapter';
import { ledgerProblem, readProposalLedger, writeProposalLedger } from './ledger';
import { decide, reopen } from './rules';
import type { Choice } from './shown';

// A started session reads its prompt as it opens; a day later the file has done its job.
const PROMPT_KEEP_MS = 24 * 60 * 60 * 1000;

const writePromptFile = ({ id, prompt }: { id: string; prompt: string }, now: Date): string => {
  const dir = FOLDERS.PROPOSAL_PROMPTS;
  mkdirSync(dir, { recursive: true });
  readdirSync(dir)
    .map((name) => resolve(dir, name))
    .filter((path) => now.getTime() - statSync(path).mtimeMs > PROMPT_KEEP_MS)
    .forEach((path) => rmSync(path, { force: true }));
  const path = resolve(dir, `${id}.prompt`);
  writeFileSync(path, prompt);
  return path;
};

const manualStart = ({ home, promptFile, launcher }: StartInput): string =>
  `To start it, run from ${home}: ${promptLaunch(launcher, promptFile)}`;

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

interface Located {
  adapter: ProposalAdapter;
  place: SessionPlace;
}

const locateIn = (adapters: readonly ProposalAdapter[], env: DecideContext['env']): Located | undefined =>
  adapters.flatMap((adapter): Located[] => {
    const place = adapter.locate(env);
    return place ? [{ adapter, place }] : [];
  })[0];

/**
 * Opens a session on a prompt through the first adapter that can reach this session, beside it (or in the workspace
 * the context names), and says where; with none, the command to run by hand.
 */
export const startPrompt = (
  item: { id: string; prompt: string },
  context: DecideContext
): { where: string } | { error: string } => {
  const input: StartInput = {
    home: context.home,
    promptFile: writePromptFile(item, context.now),
    launcher: homeLauncher(context.home)
  };
  const found = locateIn(context.adapters, context.env);
  const located =
    found && context.workspace ? { ...found, place: { ...found.place, workspaceId: context.workspace } } : found;
  try {
    return { where: located ? located.adapter.start(input, located.place) : manualStart(input) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export interface DecideContext {
  home: string;
  adapters: readonly ProposalAdapter[];
  env: Readonly<Record<string, string | undefined>>;
  now: Date;
  /**
   * The workspace a Start opens in, when the surface picked one; else beside the session that decided.
   */
  workspace?: string;
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
