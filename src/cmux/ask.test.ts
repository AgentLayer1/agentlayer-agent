import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DIST } from './build';
import { renderSidebar } from './file';
import { CMUX_DATA, fixtureEntry, NOVA, SCOUT } from './preview/fixture';
import { hasRuntime, mount, type HostAction } from './runtime-harness';
import { oneLine, shellQuote, startCommand } from './sidebar/shell';

const NOVA_HOME = NOVA.runtime.home;
const run = test.skipIf(!hasRuntime);

const installed = () =>
  renderSidebar({
    version: '1.1.0',
    homes: { [NOVA_HOME]: fixtureEntry(NOVA, 'agent'), [SCOUT.runtime.home]: fixtureEntry(SCOUT) },
    bundle: readFileSync(DIST, 'utf8')
  });

type Data = typeof CMUX_DATA;
type Workspace = Data['workspaces'][number];

const NEW_TAB = { id: 'w-nova-new-panel', surfaceId: 'w-nova-new-surface' };

/**
 * cmux's data with Nova's workspace changed.
 */
const withNova = (change: (workspace: Workspace) => Workspace): Data => ({
  ...CMUX_DATA,
  workspaces: CMUX_DATA.workspaces.map((item) => (item.id === 'w-nova' ? change(item) : item))
});

const tabOpened = withNova((workspace) => ({
  ...workspace,
  tabs: [...workspace.tabs, { ...workspace.tabs[0], ...NEW_TAB, title: 'zsh', directory: '/Users/ada' }]
}));

const agentIn = (base: Data, status: 'working' | 'idle') => ({
  ...base,
  workspaces: base.workspaces.map((item) =>
    item.id === 'w-nova'
      ? {
          ...item,
          agents: [
            ...item.agents,
            { ...item.agents[0], id: 'w-nova-new', status, panelId: NEW_TAB.id, directory: NOVA_HOME }
          ]
        }
      : item
  )
});

const typed = (actions: HostAction[]) => actions.filter((action) => action.method === 'surface.send_text');

test('a home path is one shell word whatever it holds, and a prompt never carries a line break', () => {
  expect(shellQuote("/Users/ada/Ada's Agents/Nova")).toBe(`'/Users/ada/Ada'\\''s Agents/Nova'`);
  expect(startCommand('/Users/ada/Agents/Nova', 'agent')).toBe(`cd '/Users/ada/Agents/Nova' && agent`);
  expect(oneLine('first\nsecond\r\nthird')).toBe('first second third');
});

run(
  'New chat opens a tab, starts the agent in its home, types the prompt in once it’s ready, and never sends it',
  () => {
    const sidebar = mount(installed(), CMUX_DATA);
    sidebar.tap('Ask');
    expect(sidebar.tap('Brief me')).toEqual({
      kind: 'cmux',
      method: 'surface.create',
      params: { type: 'terminal', workspace_id: 'w-nova' }
    });
    expect(sidebar.visibleTexts()).toContain('Opening a tab for Nova…');

    sidebar.setData(tabOpened);
    expect(typed(sidebar.actions)).toEqual([
      {
        kind: 'cmux',
        method: 'surface.send_text',
        params: { surface_id: NEW_TAB.surfaceId, workspace_id: 'w-nova', text: `cd '${NOVA_HOME}' && agent\n` }
      }
    ]);

    sidebar.setData(agentIn(tabOpened, 'working'));
    expect(typed(sidebar.actions)).toHaveLength(1);

    sidebar.setData(agentIn(tabOpened, 'idle'));
    expect(typed(sidebar.actions).at(-1)?.params?.text).toBe('Brief me');
    expect(sidebar.actions.at(-1)).toEqual({
      kind: 'cmux',
      method: 'surface.focus',
      params: { surface_id: NEW_TAB.surfaceId, workspace_id: 'w-nova' }
    });
    expect(sidebar.visibleTexts()).toContain('Typed in for Nova. Press Enter in that tab to send it.');
    expect(typed(sidebar.actions).every((action) => action.params?.surface_id === NEW_TAB.surfaceId)).toBe(true);
  }
);

run('a chat that was already open, or a tab opened in another workspace, is never typed into', () => {
  const sidebar = mount(installed(), CMUX_DATA);
  sidebar.tap('Ask');
  sidebar.tap('Plan my day');
  const otherWorkspaceTab = {
    ...CMUX_DATA,
    workspaces: CMUX_DATA.workspaces.map((item) =>
      item.id === 'w-code'
        ? {
            ...item,
            tabs: [...item.tabs, { ...item.tabs[0], id: 'w-code-new-panel', surfaceId: 'w-code-new-surface' }]
          }
        : item
    )
  };
  sidebar.setData(otherWorkspaceTab);
  expect(typed(sidebar.actions)).toEqual([]);

  // An existing chat re-entering cmux's short session list, idle, while the new tab's agent is still starting.
  sidebar.setData(tabOpened);
  const reentered = withNova((workspace) => ({
    ...workspace,
    tabs: [...workspace.tabs, { ...workspace.tabs[0], ...NEW_TAB }],
    agents: workspace.agents.map((agent) => ({ ...agent, status: 'idle' }))
  }));
  sidebar.setData(reentered);
  expect(typed(sidebar.actions).map((action) => action.params?.text)).toEqual([`cd '${NOVA_HOME}' && agent\n`]);
});

run('switching pages while a chat starts still types the prompt into it', () => {
  const sidebar = mount(installed(), CMUX_DATA);
  sidebar.tap('Ask');
  sidebar.tap('Check support');
  sidebar.tap('Home');
  sidebar.setData(tabOpened);
  sidebar.setData(agentIn(tabOpened, 'idle'));
  expect(typed(sidebar.actions).at(-1)?.params?.text).toBe('Check the support queue');
});

run('Draft here types into the focused chat, and not while that chat is waiting on a question', () => {
  const focusOn = (panel: string) =>
    withNova((workspace) => ({
      ...workspace,
      tabs: workspace.tabs.map((tab) => ({ ...tab, focused: tab.id === panel }))
    }));
  const sidebar = mount(installed(), focusOn('w-nova-s1-panel'));
  sidebar.tap('Ask');
  sidebar.type('Summarise the last ticket\nplease');
  expect(sidebar.tap('Draft here')).toBeUndefined();

  sidebar.setData(focusOn('w-nova-s2-panel'));
  sidebar.tap('Draft here');
  expect(typed(sidebar.actions)).toEqual([
    {
      kind: 'cmux',
      method: 'surface.send_text',
      params: { surface_id: 'w-nova-s2-surface', workspace_id: 'w-nova', text: 'Summarise the last ticket please' }
    }
  ]);
});

run('the text box’s own request opens a new chat too, and an empty box does nothing', () => {
  const sidebar = mount(installed(), CMUX_DATA);
  sidebar.tap('Ask');
  expect(sidebar.tap('New chat')).toBeUndefined();
  sidebar.type('What did I ship this week?');
  expect(sidebar.tap('New chat')?.method).toBe('surface.create');
});
