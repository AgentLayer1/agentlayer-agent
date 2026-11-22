import type { HeartbeatPlace, HomeEntry } from './data';
import { when } from './style';

/**
 * Claude, still running: the only agent a heartbeat's tab can hold.
 */
export const isRunningClaude = (agent: { kind: string; status: string }): boolean =>
  agent.kind === 'claude' && agent.status !== 'ended';

/**
 * Where the heartbeat is now: its tab, in whichever workspace holds it, while Claude runs there. A closed tab, the
 * shell Claude exited to, or another agent started in that tab has no route.
 */
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

export const choiceButton = (label: string, onTap: () => void, tint?: string) =>
  Text(label)
    .font(11)
    .weight('semibold')
    .color(tint ? '#ffffff' : 'secondary')
    .paddingHorizontal(tint ? 14 : 9)
    .paddingVertical(5)
    .background(tint ?? null)
    .cornerRadius(8)
    .hoverBackground(tint ?? '#7f7f7f3d')
    .cursor('pointer')
    .fixedSize('horizontal')
    .onTap(onTap);

/**
 * A card's buttons, each typing its command into the agent's heartbeat; with no heartbeat to reach, the hint instead.
 */
export const heartbeatActions = (
  entry: HomeEntry,
  buttons: (type: (command: string) => void) => ReturnType<typeof choiceButton>[],
  hint: string
) => {
  const place = () => heartbeatRoute(entry.heartbeat);
  const type = (command: string) => {
    const target = place();
    if (target) {
      cmux('surface.send_text', { surface_id: target.surfaceId, workspace_id: target.workspaceId, text: `${command}\n` });
    }
  };
  return [
    when(
      () => place() !== null,
      () => HStack({ spacing: 4 }, [...buttons(type), Spacer({ minLength: 0 })]).paddingTop(3)
    ),
    when(
      () => place() === null,
      () => Text(hint).font(10).color('tertiary').paddingTop(3)
    )
  ];
};
