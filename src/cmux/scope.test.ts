import { expect, test } from 'bun:test';
import { homeOf, scopedHome, type ScopeWorkspace } from './sidebar/scope';

const NOVA = '/Users/ada/Agents/Nova';
const SCOUT = '/Users/ada/Agents/Scout';
const HOMES = [NOVA, SCOUT];

const workspace = (id: string, directory: string, selected: boolean, agents: ScopeWorkspace['agents'] = []) => ({
  id,
  directory,
  selected,
  agents
});

test('a path belongs to the home it sits in, the deepest when homes nest, and never to a lookalike sibling', () => {
  expect(homeOf(HOMES, `${NOVA}/projects/blog`)).toBe(NOVA);
  expect(homeOf(HOMES, NOVA)).toBe(NOVA);
  expect(homeOf(HOMES, `${NOVA}-old/notes`)).toBeUndefined();
  expect(homeOf([...HOMES, `${NOVA}/inner`], `${NOVA}/inner/x`)).toBe(`${NOVA}/inner`);
  expect(homeOf(HOMES, undefined)).toBeUndefined();
});

test('the selected workspace’s own folder decides first', () => {
  const workspaces = [workspace('a', SCOUT, true, [{ directory: NOVA, lastActivityAt: 9 }])];
  expect(scopedHome(HOMES, workspaces, null)).toBe(SCOUT);
});

test('then its newest session inside a home', () => {
  const workspaces = [
    workspace('a', '/code/acme', true, [
      { directory: '/code/acme', lastActivityAt: 9 },
      { directory: SCOUT, lastActivityAt: 5 },
      { directory: NOVA, lastActivityAt: 1 }
    ])
  ];
  expect(scopedHome(HOMES, workspaces, null)).toBe(SCOUT);
});

test('then the agent with the newest session anywhere, then the first home', () => {
  const workspaces = [
    workspace('a', '/tmp', true),
    workspace('b', '/code', false, [
      { directory: NOVA, lastActivityAt: 3 },
      { directory: SCOUT, lastActivityAt: 7 }
    ])
  ];
  expect(scopedHome(HOMES, workspaces, null)).toBe(SCOUT);
  expect(scopedHome(HOMES, [workspace('a', '/tmp', true)], null)).toBe(NOVA);
  expect(scopedHome([], [], null)).toBeUndefined();
});

test('a pick wins only in the workspace it was made in, and only for a home that joined', () => {
  const workspaces = [workspace('a', NOVA, true), workspace('b', SCOUT, false)];
  expect(scopedHome(HOMES, workspaces, { home: SCOUT, workspaceId: 'a' })).toBe(SCOUT);
  expect(scopedHome(HOMES, workspaces, { home: SCOUT, workspaceId: 'b' })).toBe(NOVA);
  expect(scopedHome(HOMES, workspaces, { home: '/Users/ada/Agents/Gone', workspaceId: 'a' })).toBe(NOVA);
});
