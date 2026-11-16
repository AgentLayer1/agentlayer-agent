import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleSidebar, DIST } from './build';
import { homeEntry } from './entry';
import { renderSidebar } from './file';
import { CMUX_DATA, NOVA, NOVA_HOME, SCOUT, SCOUT_HOME } from './preview/fixture';
import { previewText } from './preview/preview';
import { hasRuntime, mount } from './runtime-harness';
import type { HomeEntry } from './sidebar/data';

const run = test.skipIf(!hasRuntime);
const NOVA_ENTRY = homeEntry(NOVA_HOME, NOVA);

const installed = (homes: Record<string, HomeEntry> = { [NOVA_HOME]: NOVA_ENTRY }) =>
  renderSidebar({ version: '1.1.0', homes, bundle: readFileSync(DIST, 'utf8') });

const onProjects = (homes?: Record<string, HomeEntry>) => {
  const sidebar = mount(installed(homes), CMUX_DATA);
  sidebar.tap('Agents');
  return sidebar;
};

test('sidebar/dist/sidebar.js is built from the current source', async () => {
  expect(await bundleSidebar(), 'dist is stale: run `bun run cmux:build`').toBe(readFileSync(DIST, 'utf8'));
});

run('it opens on the Manager, with its tabs beside the Manager’s title', () => {
  const texts = mount(installed(), CMUX_DATA).visibleTexts();
  expect(texts[0]).toBe('Manager');
  expect(texts).toEqual(expect.arrayContaining(['Support sweep', 'Fix the checkout total']));
});

run('Projects opens the dashboard and the roadmap as full tabs', () => {
  const sidebar = onProjects();
  expect(sidebar.tap('Dashboard')).toEqual({
    kind: 'cmux',
    method: 'browser.tab.new',
    params: { url: `${NOVA_ENTRY.dashboard}#today` }
  });
  expect(sidebar.tap('Roadmap')?.params).toEqual({ url: NOVA_ENTRY.roadmap ?? '' });
});

const between = (texts: string[], from: string, to: string) => texts.slice(texts.indexOf(from), texts.indexOf(to));

run('the Tasks card leads with every live task counted, what is overdue or due this week, folded', () => {
  const texts = onProjects().visibleTexts();
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
  const sidebar = onProjects();
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
  const texts = onProjects().visibleTexts();
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
  const sidebar = onProjects();
  sidebar.tap('AT WORK');
  expect(sidebar.visibleTexts()).not.toContain('acme-app');
  expect(sidebar.visibleTexts()).toContain('garden-shop');
  sidebar.tap('AT WORK');
  expect(sidebar.visibleTexts()).toContain('acme-app');
});

run('the search lists the tasks whose title or id has every word, in place of the cards', () => {
  const sidebar = onProjects();
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
  const sidebar = onProjects();
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

run('with two agents joined, a chip per agent picks the other one', () => {
  const sidebar = onProjects({ [NOVA_HOME]: NOVA_ENTRY, [SCOUT_HOME]: homeEntry(SCOUT_HOME, SCOUT) });
  expect(sidebar.visibleTexts()).toEqual(expect.arrayContaining(['🦉 Nova', '🐢 Scout']));
  sidebar.tap('🐢 Scout');
  expect(sidebar.visibleTexts()).toContain('No projects yet.');
  expect(sidebar.visibleTexts()).not.toContain('acme-app');
});

run('with one agent joined, its chip stands beside the tabs where the title was', () => {
  const texts = onProjects().visibleTexts();
  expect(texts[0]).toBe('🦉 Nova');
});

run('an entry from an older plugin asks for its agent to be updated', () => {
  const texts = onProjects({ [NOVA_HOME]: { ...NOVA_ENTRY, schema: 1 } }).visibleTexts();
  expect(texts).toContain('🦉 Nova needs its agent updated to show here.');
  expect(texts).not.toContain('acme-app');
});

run('the preview draws invented homes and sessions on its own, and its taps go nowhere', () => {
  const preview = mount(previewText({ version: '1.1.0', bundle: readFileSync(DIST, 'utf8') }));
  expect(preview.visibleTexts()).toContain('Support sweep');
  preview.tap('Agents');
  expect(preview.visibleTexts()).toContain('acme-app');
  expect(preview.tap('Dashboard')).toBeUndefined();
});

run('two pins with the same title both show, each opening its own file', () => {
  const [first, ...rest] = NOVA_ENTRY.projects;
  if (!first) {
    throw new Error('the fixture has projects');
  }
  const twins = {
    ...first,
    pins: [
      { title: 'Notes', icon: '📝', target: { kind: 'file' as const, path: join(NOVA_HOME, 'a.md') } },
      { title: 'Notes', icon: '📝', target: { kind: 'file' as const, path: join(NOVA_HOME, 'b.md') } }
    ]
  };
  const sidebar = onProjects({ [NOVA_HOME]: { ...NOVA_ENTRY, projects: [twins, ...rest] } });
  sidebar.tap(first.slug);
  expect(sidebar.visibleTexts().filter((text) => text === 'Notes')).toHaveLength(2);
});

const onReports = (homes?: Record<string, HomeEntry>) => {
  const sidebar = onProjects(homes);
  sidebar.tap('Reports');
  return sidebar;
};

run('Reports lists the pins, then the newest reports by day, worded against the sidebar’s day', () => {
  const texts = onReports().visibleTexts();
  const headings = texts.filter((text) => /^[A-Z0-9 ]+$/.test(text) && !/^[0-9]+$/.test(text));
  expect(headings).toEqual(['PINNED', 'TODAY', 'YESTERDAY', 'MON 2 NOV']);
  const titles = ['Support playbook', 'Morning brief — Mon 9 Nov', 'Checkpoints — 4 sessions'];
  expect(
    texts.filter((text) => titles.includes(text)),
    'pins first, then today, newest first'
  ).toEqual(titles);
  expect(texts, 'earlier days start folded').not.toContain('Evening wrap — Sun 8 Nov');
  expect(texts).toEqual(
    expect.arrayContaining(['Launch checklist', 'Pricing page', 'acme-app', 'briefing', '8:30 AM'])
  );
  expect(
    texts.some((text) => ['🟢', '🟠', '🔴', '⏳'].includes(text)),
    'no status marks'
  ).toBe(false);
  expect(texts).not.toContain('AT WORK');
});

run('a report opens as a full tab, and Dashboard opens the dashboard’s Reports page', () => {
  const sidebar = onReports();
  expect(sidebar.tap('Morning brief — Mon 9 Nov')).toEqual({
    kind: 'cmux',
    method: 'file.open',
    params: { path: join(NOVA_HOME, 'reports', 'briefings', '2026-11-09-0830-morning.md') }
  });
  expect(sidebar.tap('Dashboard')?.params).toEqual({ url: `${NOVA_ENTRY.dashboard}#reports` });
  sidebar.tap('Projects');
  expect(sidebar.tap('Dashboard')?.params).toEqual({ url: `${NOVA_ENTRY.dashboard}#today` });
});

run('the report search matches titles and kinds, folded days included', () => {
  const sidebar = onReports();
  sidebar.type('briefing');
  expect(sidebar.visibleTexts().filter((text) => text.includes('—'))).toEqual([
    'Morning brief — Mon 9 Nov',
    'Evening wrap — Sun 8 Nov'
  ]);
  expect(sidebar.visibleTexts()).not.toContain('PINNED');
  sidebar.type('nothing like this');
  expect(sidebar.visibleTexts()).toContain('No matching reports.');
});

run('reports past the entry’s limit point to the dashboard', () => {
  const sidebar = onReports({ [NOVA_HOME]: { ...NOVA_ENTRY, olderReports: 3 } });
  expect(sidebar.tap('3 older reports are on the dashboard.')?.params).toEqual({
    url: `${NOVA_ENTRY.dashboard}#reports`
  });
});

run('a dozen agents all get a chip', () => {
  const names = Array.from({ length: 12 }, (_unused, index) => `Agent${index}`);
  const homes = Object.fromEntries(
    names.map((name) => [join('/Users', 'ada', 'Documents', 'Agents', name), { ...NOVA_ENTRY, name, emoji: '🤖' }])
  );
  const texts = onProjects(homes).visibleTexts();
  expect(names.every((name) => texts.includes(`🤖 ${name}`))).toBe(true);
});

run('every report group folds and opens on its own, and times read in twelve hours', () => {
  const sidebar = onReports();
  sidebar.tap('YESTERDAY');
  sidebar.tap('MON 2 NOV');
  expect(sidebar.visibleTexts()).toEqual(expect.arrayContaining(['8:30 AM', '7:10 AM', '9:00 PM', '2:20 PM']));
  sidebar.tap('TODAY');
  expect(sidebar.visibleTexts()).not.toContain('Morning brief — Mon 9 Nov');
  expect(sidebar.visibleTexts()).toContain('Evening wrap — Sun 8 Nov');
  sidebar.tap('TODAY');
  expect(sidebar.visibleTexts()).toContain('Morning brief — Mon 9 Nov');
  sidebar.tap('PINNED');
  expect(sidebar.visibleTexts()).not.toContain('Support playbook');
  expect(sidebar.visibleTexts()).toContain('PINNED');
});
