import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleSidebar, DIST } from './build';
import { homeEntry } from './entry';
import { renderSidebar } from './file';
import { CMUX_DATA, NOVA, SCOUT } from './preview/fixture';
import { previewText } from './preview/preview';
import { hasRuntime, mount } from './runtime-harness';
import type { HomeEntry } from './sidebar/data';

const run = test.skipIf(!hasRuntime);
const NOVA_HOME = NOVA.runtime.home;
const NOVA_ENTRY = homeEntry(NOVA);

const installed = (homes: Record<string, HomeEntry> = { [NOVA_HOME]: NOVA_ENTRY }) =>
  renderSidebar({ version: '1.1.0', homes, bundle: readFileSync(DIST, 'utf8') });

const onWork = (homes?: Record<string, HomeEntry>) => {
  const sidebar = mount(installed(homes), CMUX_DATA);
  sidebar.tap('Work');
  return sidebar;
};

test('sidebar/dist/sidebar.js is built from the current source', async () => {
  expect(await bundleSidebar(), 'dist is stale: run `bun run cmux:build`').toBe(readFileSync(DIST, 'utf8'));
});

run('it opens on the Manager, with its tabs where the Manager’s title was', () => {
  const texts = mount(installed(), CMUX_DATA).visibleTexts();
  expect(texts).not.toContain('Manager');
  expect(texts).toEqual(expect.arrayContaining(['Support sweep', 'Fix the checkout total']));
});

run('Work opens the dashboard and the roadmap as full tabs', () => {
  const sidebar = onWork();
  expect(sidebar.tap('Dashboard')).toEqual({
    kind: 'cmux',
    method: 'browser.tab.new',
    params: { url: `${NOVA_ENTRY.dashboard}#today` }
  });
  expect(sidebar.tap('Roadmap')?.params).toEqual({ url: NOVA_ENTRY.roadmap ?? '' });
});

run('each project is a card with its counts and the task it needs next, at work first', () => {
  const texts = onWork().visibleTexts();
  const cards = texts.filter((text) => ['acme-app', 'garden-shop', 'blog'].includes(text));
  expect(cards).toEqual(['acme-app', 'garden-shop', 'blog']);
  const acme = texts.slice(texts.indexOf('acme-app'), texts.indexOf('garden-shop'));
  expect(acme, 'name, 1 active, 2 open, then the next task').toEqual(['acme-app', '1', '2', 'Ship the invoice export']);
});

run('a card opens into its tasks, each with its id, priority and due date read against today', () => {
  const sidebar = onWork();
  sidebar.tap('acme-app');
  const texts = sidebar.visibleTexts();
  const rows = texts.slice(texts.indexOf('acme-app') + 3, texts.indexOf('garden-shop'));
  expect(rows).toEqual([
    'Ship the invoice export',
    'ac-101',
    'P1',
    'overdue 2d',
    'Fix the checkout total',
    'ac-102',
    'P0',
    'due tomorrow',
    'Write the release notes',
    'ac-103',
    'P2',
    'due in 22d'
  ]);
  expect(sidebar.tap('Fix the checkout total')).toEqual({
    kind: 'cmux',
    method: 'file.open',
    params: { path: join(NOVA_HOME, 'projects', 'acme-app', 'tasks', 'ac-102.md') }
  });
});

run('with two agents joined, a menu picks the other one', () => {
  const sidebar = onWork({ [NOVA_HOME]: NOVA_ENTRY, [SCOUT.runtime.home]: homeEntry(SCOUT) });
  expect(sidebar.menuItems()).toEqual(['🦉 Nova', '🐢 Scout']);
  sidebar.tap('🐢 Scout');
  expect(sidebar.visibleTexts()).toContain('No projects yet.');
  expect(sidebar.visibleTexts()).not.toContain('acme-app');
});

run('with one agent joined there is no menu', () => {
  expect(onWork().menuItems()).toEqual([]);
});

run('an entry from an older plugin asks for its agent to be updated', () => {
  const texts = onWork({ [NOVA_HOME]: { ...NOVA_ENTRY, schema: 1 } }).visibleTexts();
  expect(texts).toContain('🦉 Nova needs its agent updated to show here.');
  expect(texts).not.toContain('acme-app');
});

run('the preview draws invented homes and sessions on its own, and its taps go nowhere', () => {
  const preview = mount(previewText({ version: '1.1.0', bundle: readFileSync(DIST, 'utf8') }));
  expect(preview.visibleTexts()).toContain('Support sweep');
  preview.tap('Work');
  expect(preview.visibleTexts()).toContain('acme-app');
  expect(preview.tap('Dashboard')).toBeUndefined();
});
