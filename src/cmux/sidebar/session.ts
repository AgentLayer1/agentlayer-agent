import type { HomeEntry } from './data';

/**
 * Opens Claude in the home on a slash command the plugin builds: a focused tab in the selected workspace, or a
 * workspace of its own when none is selected or the selected one is remote, which can't take startup input.
 */
export const openSession = (entry: HomeEntry, command: string): void => {
  const selected = (data.workspaces() ?? []).find((workspace) => workspace.selected);
  const input = `${entry.launcher} "${command}"\r`;
  if (selected && !selected.remote) {
    cmux('surface.create', { workspace_id: selected.id, working_directory: entry.home, initial_input: input, focus: true });
  } else {
    cmux('workspace.create', { cwd: entry.home, initial_input: input });
  }
};

/**
 * A faint icon that opens a session to talk `ref` (`task:<id>`, `goal:<horizon>:<n>`) through with the agent. It sits
 * on every row of long lists, so it tracks no hover of its own.
 */
export const discussIcon = (entry: HomeEntry, ref: string) =>
  Image('bubble.left')
    .font(10)
    .color('tertiary')
    .opacity(0.55)
    .padding(3)
    .help(`Discuss with ${entry.name}`)
    .onTap(() => openSession(entry, `/${entry.plugin}:discuss ${ref}`));
