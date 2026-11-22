/**
 * The parts of a cmux workspace that say which agent it belongs to.
 */
export interface ScopeWorkspace {
  id: string;
  selected: boolean;
  directory: string;
  agents?: readonly { directory?: string; lastActivityAt: number }[];
}

/**
 * An agent picked by its chip on Projects, held only while the workspace it was picked in stays selected.
 */
export interface Pin {
  home: string;
  workspaceId: string;
}

/**
 * The home a path is in, the deepest one when homes nest.
 */
export const homeOf = (homes: readonly string[], path: string | undefined): string | undefined =>
  path
    ? homes.filter((home) => path === home || path.startsWith(`${home}/`)).toSorted((a, b) => b.length - a.length)[0]
    : undefined;

const newestHome = (homes: readonly string[], agents: ScopeWorkspace['agents'] = []): string | undefined =>
  agents
    .toSorted((a, b) => b.lastActivityAt - a.lastActivityAt)
    .map((agent) => homeOf(homes, agent.directory))
    .find((home) => home !== undefined);

/**
 * Which agent the sidebar shows: the one picked in this workspace, else the workspace's own folder's,
 * else its newest session's, else whichever agent was active last.
 */
export const scopedHome = (
  homes: readonly string[],
  workspaces: readonly ScopeWorkspace[],
  pin: Pin | null
): string | undefined => {
  const selected = workspaces.find((workspace) => workspace.selected);
  const picked = pin && selected && pin.workspaceId === selected.id && homes.includes(pin.home) ? pin.home : undefined;
  return (
    picked ??
    homeOf(homes, selected?.directory) ??
    newestHome(homes, selected?.agents) ??
    newestHome(
      homes,
      workspaces.flatMap((workspace) => workspace.agents ?? [])
    ) ??
    homes[0]
  );
};

/**
 * The agent the selected workspace belongs to: its folder's, else its newest session's; undefined when neither says.
 */
export const workspaceHome = (homes: readonly string[], workspaces: readonly ScopeWorkspace[]): string | undefined => {
  const selected = workspaces.find((workspace) => workspace.selected);
  return homeOf(homes, selected?.directory) ?? newestHome(homes, selected?.agents);
};
