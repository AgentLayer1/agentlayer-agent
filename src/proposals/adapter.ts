/**
 * Where a session lives, in the terms of the one adapter that can reach it again. The union grows by a member per
 * adapter, so each adapter's fields stay typed.
 */
export type SessionPlace = { adapter: 'cmux'; surfaceId: string; workspaceId: string };

export type Launcher = 'agent' | 'claude';

/**
 * The fields a proposal is shown and started by. The prompt stays in the ledger and travels only as a file.
 */
export interface ProposalSummary {
  id: string;
  title: string;
}

export interface StartInput {
  home: string;
  proposal: ProposalSummary;
  /**
   * Absolute path of the file holding the prompt the new session runs.
   */
  promptFile: string;
  launcher: Launcher;
}

/**
 * A place proposals can be shown and started from: a workspace app, a terminal multiplexer, a hosted page. The core
 * works with none; each adapter extends it.
 */
export interface ProposalAdapter {
  name: SessionPlace['adapter'];
  /**
   * The current process's place when this adapter can reach it, read from the environment the process inherited.
   */
  locate: (env: Readonly<Record<string, string | undefined>>) => SessionPlace | null;
  /**
   * Opens a session running the proposal's prompt, and says where it opened.
   */
  start: (input: StartInput) => string;
  /**
   * Redraws wherever this adapter shows proposals.
   */
  publish: (home: string) => void;
}
