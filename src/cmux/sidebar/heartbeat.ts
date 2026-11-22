import type { HeartbeatPlace } from './data';

/**
 * Claude, still running: the only agent a heartbeat's tab can hold.
 */
export const isRunningClaude = (agent: { kind: string; status: string }): boolean =>
  agent.kind === 'claude' && agent.status !== 'ended';

/**
 * Where the heartbeat is now: its tab, in whichever workspace holds it, while Claude runs there. A closed tab, the
 * shell Claude exited to, or another agent started in that tab has no route.
 */
/**
 * Whether the heartbeat's tab is waiting on the operator (a permission prompt, a question), where typed text and its
 * Enter would answer it.
 */
export const heartbeatWaiting = (place: HeartbeatPlace | null): boolean =>
  place !== null &&
  (data.workspaces() ?? []).some((workspace) =>
    workspace.tabs.some(
      (tab) =>
        tab.surfaceId === place.surfaceId &&
        (workspace.agents ?? []).some((agent) => agent.panelId === tab.id && agent.status === 'needs_input')
    )
  );

export const heartbeatRoute = (place: HeartbeatPlace | null): HeartbeatPlace | null => {
  const found =
    place &&
    (data.workspaces() ?? []).find((workspace) =>
      workspace.tabs.some(
        (tab) =>
          tab.surfaceId === place.surfaceId &&
          (workspace.agents ?? []).some((agent) => agent.panelId === tab.id && isRunningClaude(agent))
      )
    );
  return place && found ? { surfaceId: place.surfaceId, workspaceId: found.id } : null;
};
