import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

run('both tabs end their top row with a button that reloads the sidebar’s file', () => {
  const reload = { kind: 'cmux', method: 'sidebar.custom.reload', params: { name: 'agentlayer' } };
  expect(mount(installed(), CMUX_DATA).tap('Reload the sidebar')).toEqual(reload);
  expect(onWork().tap('Reload the sidebar')).toEqual(reload);
});

const between = (texts: string[], from: string, to: string) => texts.slice(texts.indexOf(from), texts.indexOf(to));

run('the Tasks card leads with every live task counted, what is overdue or due this week, folded', () => {
  const texts = onWork().visibleTexts();
  expect(between(texts, 'Tasks', 'AT WORK'), 'title, 1 active, 1 blocked, 3 open, then the due tallies').toEqual([
    'Tasks',
    '1',
    '1',
    '3',
    '1 overdue',
    '1 due this week'
  ]);
});

run('the Tasks card opens into the agenda: in flight, then by due date, leaving undated tasks to the counts', () => {
  const sidebar = onWork();
  sidebar.tap('Tasks');
  const titles = between(sidebar.visibleTexts(), 'IN FLIGHT', 'AT WORK').filter(
    (text) => /^[A-Z ]+$/.test(text) || text.includes(' the ')
  );
  expect(titles).toEqual([
    'IN FLIGHT',
    'Ship the invoice export',
    'THIS WEEK',
    'Fix the checkout total',
    'THIS MONTH',
    'Write the release notes'
  ]);
});

run('projects are grouped at work, blocked and quiet, each card with its counts and the task it needs next', () => {
  const texts = onWork().visibleTexts();
  const outline = texts.filter((text) =>
    ['AT WORK', 'BLOCKED', 'QUIET', 'acme-app', 'garden-shop', 'blog'].includes(text)
  );
  expect(outline).toEqual(['AT WORK', 'acme-app', 'BLOCKED', 'garden-shop', 'QUIET', 'blog']);
  expect(texts.slice(texts.indexOf('QUIET'))).toEqual(['QUIET', '1', 'blog']);
  expect(between(texts, 'acme-app', 'BLOCKED'), 'name, 1 active, 2 open, then the next task').toEqual([
    'acme-app',
    '1',
    '2',
    'Ship the invoice export'
  ]);
});

run('each state group folds away and back on its own', () => {
  const sidebar = onWork();
  sidebar.tap('AT WORK');
  expect(sidebar.visibleTexts()).not.toContain('acme-app');
  expect(sidebar.visibleTexts()).toContain('garden-shop');
  sidebar.tap('AT WORK');
  expect(sidebar.visibleTexts()).toContain('acme-app');
});

run('the search lists the tasks whose title or id has every word, in place of the cards', () => {
  const sidebar = onWork();
  sidebar.type('the CHECKOUT');
  const texts = sidebar.visibleTexts();
  expect(texts.filter((text) => text.includes(' the '))).toEqual(['Fix the checkout total']);
  expect(texts).not.toContain('AT WORK');
  sidebar.type('gs-20');
  expect(sidebar.visibleTexts().filter((text) => text.includes(' the '))).toEqual([
    'Wait on the supplier price list',
    'Photograph the spring range'
  ]);
  sidebar.type('nothing like this');
  expect(sidebar.visibleTexts()).toContain('No matching tasks.');
  sidebar.type('');
  expect(sidebar.visibleTexts()).toContain('AT WORK');
});

run('a card opens into its roadmap, its pins, then its tasks with id, priority, due words and comments', () => {
  const sidebar = onWork();
  sidebar.tap('acme-app');
  const texts = sidebar.visibleTexts();
  expect(between(texts, 'acme-app', 'BLOCKED').slice(3)).toEqual([
    '🗺️',
    'Roadmap',
    '✅',
    'Launch checklist',
    '📊',
    'Pricing page',
    'Ship the invoice export',
    'ac-101',
    'P1',
    'overdue 2d',
    '3',
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
  expect(sidebar.tap('Launch checklist')).toEqual({
    kind: 'cmux',
    method: 'file.open',
    params: { path: join(NOVA_HOME, 'projects', 'acme-app', 'launch-checklist.md') }
  });
  expect(sidebar.tap('Pricing page')).toEqual({
    kind: 'cmux',
    method: 'browser.tab.new',
    params: { url: pathToFileURL(join(NOVA_HOME, 'reports', 'plans', 'pricing.html')).href }
  });
  expect(sidebar.tap('Roadmap'), 'the project’s roadmap, not the home’s').toEqual({
    kind: 'cmux',
    method: 'browser.tab.new',
    params: { url: pathToFileURL(join(NOVA_HOME, 'projects', 'acme-app', 'roadmap.html')).href }
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
