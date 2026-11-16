import type { HomeEntry } from './data';
import { oneLine, startCommand } from './shell';

type Launch =
  | { stage: 'idle' }
  | { stage: 'opening'; workspaceId: string; before: string[]; command: string; prompt: string; name: string }
  | { stage: 'starting'; workspaceId: string; tabId: string; surfaceId: string; prompt: string; name: string }
  | { stage: 'drafted'; name: string };

const STATUS: Record<Exclude<Launch['stage'], 'idle'>, (name: string) => string> = {
  opening: (name) => `Opening a tab for ${name}…`,
  starting: (name) => `Starting ${name}…`,
  drafted: (name) => `Typed in for ${name}. Press Enter in that tab to send it.`
};

const workspaceById = (id: string) => (data.workspaces() ?? []).find((workspace) => workspace.id === id);
const selected = () => (data.workspaces() ?? []).find((workspace) => workspace.selected);

const send = (workspaceId: string, surfaceId: string, text: string) =>
  cmux('surface.send_text', { surface_id: surfaceId, workspace_id: workspaceId, text });

/**
 * Starting a chat and typing a prompt into it, for the app's lifetime so a page switch never strands one.
 * It types only into the tab it opened, found by its id, and never presses Enter after a prompt.
 */
export const createAsk = () => {
  const [launch, setLaunch] = signal<Launch>({ stage: 'idle' });

  // The tab this launch opened: the first one in its workspace that wasn't there at the tap.
  computed(() => {
    const state = launch();
    if (state.stage !== 'opening') {
      return;
    }
    const tab = (workspaceById(state.workspaceId)?.tabs ?? []).find(
      (item) => !state.before.includes(item.id) && item.surfaceId
    );
    if (tab?.surfaceId) {
      const { workspaceId, prompt, name } = state;
      setLaunch({ stage: 'starting', workspaceId, tabId: tab.id, surfaceId: tab.surfaceId, prompt, name });
      send(state.workspaceId, tab.surfaceId, `${state.command}\n`);
    }
  });

  // The agent started in that tab is ready for its prompt once it's idle.
  computed(() => {
    const state = launch();
    if (state.stage !== 'starting') {
      return;
    }
    const agent = (workspaceById(state.workspaceId)?.agents ?? []).find((item) => item.panelId === state.tabId);
    if (agent?.status === 'idle') {
      setLaunch({ stage: 'drafted', name: state.name });
      send(state.workspaceId, state.surfaceId, state.prompt);
      cmux('surface.focus', { surface_id: state.surfaceId, workspace_id: state.workspaceId });
    }
  });

  // The focused tab's agent, when it can take a draft: not waiting on a question or permission, and not ended.
  const draftTarget = computed(() => {
    const workspace = selected();
    const tab = workspace?.tabs.find((item) => item.focused);
    const agent = workspace?.agents?.find((item) => item.panelId === tab?.id);
    return workspace && tab?.surfaceId && agent && agent.status !== 'needs_input' && agent.status !== 'ended'
      ? { workspaceId: workspace.id, surfaceId: tab.surfaceId }
      : null;
  });

  return {
    status: () => {
      const state = launch();
      return state.stage === 'idle' ? '' : STATUS[state.stage](state.name);
    },
    canDraft: () => draftTarget() !== null,
    newChat: (home: string, entry: HomeEntry, prompt: string) => {
      const workspace = selected();
      if (!workspace) {
        return;
      }
      setLaunch({
        stage: 'opening',
        workspaceId: workspace.id,
        before: workspace.tabs.map((tab) => tab.id),
        command: startCommand(home, entry.launcher),
        prompt: oneLine(prompt),
        name: entry.name
      });
      cmux('surface.create', { type: 'terminal', workspace_id: workspace.id });
    },
    draftHere: (prompt: string) => {
      const target = draftTarget();
      if (target && prompt.trim()) {
        send(target.workspaceId, target.surfaceId, oneLine(prompt));
        cmux('surface.focus', { surface_id: target.surfaceId, workspace_id: target.workspaceId });
      }
    }
  };
};

export type Ask = ReturnType<typeof createAsk>;
