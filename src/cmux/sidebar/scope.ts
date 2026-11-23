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
 * The agent the selected workspace belongs to: its folder's, else its newest session's; undefined when neither says.
 */
export const workspaceHome = (homes: readonly string[], workspaces: readonly ScopeWorkspace[]): string | undefined => {
  const selected = workspaces.find((workspace) => workspace.selected);
  return homeOf(homes, selected?.directory) ?? newestHome(homes, selected?.agents);
};

export const scopedHome = (homes: readonly string[], workspaces: readonly ScopeWorkspace[]): string | undefined =>
  workspaceHome(homes, workspaces) ??
  newestHome(
    homes,
    workspaces.flatMap((workspace) => workspace.agents ?? [])
  ) ??
  homes[0];
