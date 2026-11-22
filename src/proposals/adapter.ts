import type { SessionLauncher } from '@/sessions/launch';

/**
 * A place proposals can be shown and started from: a session launcher that also shows them. The core works with none;
 * each adapter extends it.
 */
export interface ProposalAdapter extends SessionLauncher {
  /**
   * Redraws wherever this adapter shows proposals.
   */
  publish: (home: string) => void;
}
