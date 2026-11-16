import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleSidebar, DIST } from './build';
import { renderSidebar } from './file';
import { previewText } from './lifecycle';
import { CMUX_DATA, fixtureEntry, NOVA, SCOUT, selecting } from './preview/fixture';
import { hasRuntime, mount } from './runtime-harness';
import type { HomeEntry } from './sidebar/data';

const NOVA_HOME = NOVA.runtime.home;
const SCOUT_HOME = SCOUT.runtime.home;
const NOVA_ENTRY = fixtureEntry(NOVA);

const installed = (homes: Record<string, HomeEntry> = { [NOVA_HOME]: NOVA_ENTRY, [SCOUT_HOME]: fixtureEntry(SCOUT) }) =>
  renderSidebar({ version: '1.1.0', homes, bundle: readFileSync(DIST, 'utf8') });

const run = test.skipIf(!hasRuntime);

const between = (texts: string[], from: string, to?: string) => {
  const start = texts.indexOf(from);
  const end = to ? texts.indexOf(to) : texts.length;
  return texts.slice(start + 1, end);
};

test('sidebar/dist/sidebar.js is built from the current source', async () => {
  expect(await bundleSidebar(), 'dist is stale: run `bun run cmux:build`').toBe(readFileSync(DIST, 'utf8'));
});

run('the agent bar lists every joined home, with a count of the sessions waiting on each', () => {
  const texts = mount(installed(), CMUX_DATA).visibleTexts();
  expect(texts.slice(0, 4)).toEqual(['AgentLayer', '🦉 Nova', '1', '🐢 Scout']);
});

run('the selected workspace’s folder picks the agent, and Home shows what that agent keeps', () => {
  const texts = mount(installed(), CMUX_DATA).visibleTexts();
  expect(between(texts, 'NEEDS YOU', 'OPEN'), 'count, then the card: title, age, workspace').toEqual([
    '1',
    'Support sweep',
    '4m',
    'Nova'
  ]);
  expect(between(texts, 'OPEN', 'PROJECTS')).toEqual(['Today', 'Tasks', 'Roadmap']);
  expect(between(texts, 'PROJECTS', 'PINNED')).toEqual(['acme-app', 'blog', 'garden-shop']);
  expect(between(texts, 'PINNED')).toEqual(['Support playbook', 'Q4 review']);
});

run('a code-repo workspace picks the agent from its session’s folder', () => {
  const texts = mount(installed(), selecting('w-code')).visibleTexts();
  expect(texts).toContain('Scout');
  expect(between(texts, 'NEEDS YOU', 'OPEN')).toEqual(['0', 'Nothing needs you.']);
  expect(texts).not.toContain('PROJECTS');
  expect(texts).not.toContain('Roadmap');
});

run('a workspace outside every home shows the agent that was active last', () => {
  expect(mount(installed(), selecting('w-other')).visibleTexts()).toContain('Scout');
});

run('a chip picks another agent until a different workspace is selected', () => {
  const sidebar = mount(installed(), CMUX_DATA);
  sidebar.tap('🐢 Scout');
  expect(sidebar.visibleTexts()).toContain('Nothing needs you.');
  sidebar.setData(selecting('w-other'));
  sidebar.setData(selecting('w-nova'));
  expect(sidebar.visibleTexts()).toContain('Support playbook');
});

run('Home’s rows open the dashboard’s pages, notes and HTML pages beside the chat', () => {
  const sidebar = mount(installed(), CMUX_DATA);
  expect(sidebar.tap('Today')).toEqual({
    kind: 'cmux',
    method: 'browser.open_split',
    params: { url: `${NOVA_ENTRY.dashboard}#today` }
  });
  expect(sidebar.tap('acme-app')).toEqual({
    kind: 'cmux',
    method: 'markdown.open',
    params: { path: join(NOVA_HOME, 'projects', 'acme-app', 'README.md') }
  });
  expect(sidebar.tap('Support playbook')?.method).toBe('markdown.open');
  expect(sidebar.tap('Q4 review')?.method).toBe('browser.open_split');
  expect(sidebar.tap('Support sweep')).toEqual({
    kind: 'cmux',
    method: 'surface.focus',
    params: { surface_id: 'w-nova-s1-surface', workspace_id: 'w-nova' }
  });
});

run('an entry from an older plugin asks for its agent to be updated', () => {
  const texts = mount(installed({ [NOVA_HOME]: { ...NOVA_ENTRY, schema: 0 } }), CMUX_DATA).visibleTexts();
  expect(texts).toContain('🦉 Nova needs its agent updated to show here.');
  expect(texts).not.toContain('PROJECTS');
});

run('Agents lists every session under its agent, most urgent first, with the rest under Other', () => {
  const sidebar = mount(installed(), CMUX_DATA);
  sidebar.tap('Agents');
  const texts = sidebar.visibleTexts();
  const cards = ['Support sweep', 'Morning brief', 'Fix the checkout total', 'Rename the photos'];
  const outline = texts
    .slice(texts.indexOf('Agents') + 1)
    .filter((text) => ['🦉 Nova', '🐢 Scout', 'Other', ...cards].includes(text));
  expect(outline).toEqual([
    '🦉 Nova',
    'Support sweep',
    'Morning brief',
    '🐢 Scout',
    'Fix the checkout total',
    'Other',
    'Rename the photos'
  ]);
  expect(sidebar.tap('Fix the checkout total')?.params).toEqual({
    surface_id: 'w-code-s3-surface',
    workspace_id: 'w-code'
  });
});

run('switching pages rebuilds the page you come back to', () => {
  const sidebar = mount(installed(), CMUX_DATA);
  sidebar.tap('Agents');
  expect(sidebar.visibleTexts()).not.toContain('PROJECTS');
  sidebar.tap('Home');
  expect(sidebar.visibleTexts()).toContain('PROJECTS');
  expect(sidebar.visibleTexts()).not.toContain('Other');
});

run('the preview draws invented homes and sessions on its own, and its taps go nowhere', () => {
  const preview = mount(previewText({ version: '1.1.0', bundle: readFileSync(DIST, 'utf8') }));
  expect(preview.visibleTexts()).toEqual(expect.arrayContaining(['🦉 Nova', 'Support sweep', 'acme-app']));
  expect(preview.tap('Support sweep')).toBeUndefined();
  expect(preview.tap('Today')).toBeUndefined();
});

run('a sidebar no home has joined says how to join', () => {
  expect(mount(installed({}), CMUX_DATA).visibleTexts()).toContain(
    'No agent has joined this sidebar yet. In an agent’s home, run its cmux sidebar install.'
  );
});
