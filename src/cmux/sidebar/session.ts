import type { HomeEntry } from './data';

/**
 * Opens Claude in the home on a slash command the plugin builds: a focused tab in the selected workspace, or a
 * workspace of its own when none is selected or the selected one is remote, which can't take startup input.
 */
export const openSession = (home: string, entry: HomeEntry, command: string): void => {
  const selected = (data.workspaces() ?? []).find((workspace) => workspace.selected);
  const input = `${entry.launcher} "${command}"\r`;
  if (selected && !selected.remote) {
    cmux('surface.create', { workspace_id: selected.id, working_directory: home, initial_input: input, focus: true });
  } else {
    cmux('workspace.create', { cwd: home, initial_input: input });
  }
};
