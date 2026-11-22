import type { HomeEntry } from './data';
import { placeFor, type PlaceAgent, type Placement, type WorkHint } from './placement';
import { YELLOW } from './style';

const agentOf = (entry: HomeEntry): PlaceAgent => ({
  name: entry.name,
  home: entry.home,
  folders: entry.codeFolders ?? [],
  ...(entry.heartbeat ? { heartbeatSurface: entry.heartbeat.surfaceId } : {})
});

/**
 * The workspace a session for `hint` belongs in, among the agent's own; the other joined agents' are never chosen.
 */
export const placeSession = (entry: HomeEntry, hint: WorkHint): Placement =>
  placeFor(
    data.workspaces() ?? [],
    agentOf(entry),
    Object.values(DATA.homes)
      .filter((other) => other.home !== entry.home)
      .map(agentOf),
    hint
  );

/**
 * Opens Claude in the home on a slash command the plugin builds, as a focused tab in the workspace that fits the work
 * (see `placeFor`), or a workspace of its own when none does.
 */
export const openSession = (entry: HomeEntry, command: string, hint: WorkHint = {}): void => {
  const input = `${entry.launcher} "${command}"\r`;
  const target = placeSession(entry, hint);
  if (target.kind === 'workspace') {
    cmux('workspace.select', { workspace_id: target.id });
    cmux('surface.create', { workspace_id: target.id, working_directory: entry.home, initial_input: input, focus: true });
  } else {
    cmux('workspace.create', { cwd: entry.home, initial_input: input });
  }
};

/**
 * An icon that opens a session to talk `ref` (`task:<id>`, `goal:<horizon>:<n>`) through with the agent, placed by
 * `hint`: the sparkles of the agent's own headlines, since a speech bubble already counts comments. It sits on every
 * row of long lists, so it tracks no hover of its own.
 */
export const discussIcon = (entry: HomeEntry, ref: string, hint: WorkHint = {}) =>
  Image('sparkles')
    .font(10)
    .color(YELLOW)
    .opacity(0.6)
    .padding(3)
    .help(`Discuss with ${entry.name}`)
    .onTap(() => openSession(entry, `/${entry.plugin}:discuss ${ref}`, hint));
