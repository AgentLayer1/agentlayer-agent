import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleSidebar, DIST } from './build';
import { homeEntry } from './entry';
import { renderSidebar } from './file';
import { CMUX_DATA, NOVA, NOVA_HOME, NOVA_STATE, SCOUT, SCOUT_HOME, SCOUT_STATE, selecting } from './preview/fixture';
import { previewText } from './preview/preview';
import { hasRuntime, mount } from './runtime-harness';
import type { HomeEntry } from './sidebar/data';
import type { NoteLedger } from '@/notes/ledger';
import { nowISO } from '@/shared/date';

const run = test.skipIf(!hasRuntime);
const NOVA_ENTRY = homeEntry(NOVA_HOME, NOVA, NOVA_STATE);

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

run('the Manager leaves out the heartbeat’s own tab until it needs you', () => {
  expect(mount(installed(), CMUX_DATA).visibleTexts()).not.toContain('Morning brief');
  const asking = {
    ...CMUX_DATA,
    workspaces: CMUX_DATA.workspaces.map((item) => ({
      ...item,
      agents: item.agents.map((agent) =>
        agent.title === 'Morning brief' ? { ...agent, status: 'needs_input' as const } : agent
      )
    }))
  };
  expect(mount(installed(), asking).visibleTexts()).toContain('Morning brief');
  const noHeartbeat = { [NOVA_HOME]: { ...NOVA_ENTRY, heartbeat: null } };
  expect(mount(installed(noHeartbeat), CMUX_DATA).visibleTexts()).toContain('Morning brief');
});

const SCOUT_ENTRY = homeEntry(SCOUT_HOME, SCOUT, SCOUT_STATE);

run('PROPOSED leads the Manager above NEEDS YOU, its cards closed and its put-off and started ones hidden', () => {
  const sidebar = mount(installed(), CMUX_DATA);
  const folded = sidebar.visibleTexts();
  expect(folded.indexOf('PROPOSED')).toBeGreaterThan(-1);
  expect(folded.indexOf('PROPOSED')).toBeLessThan(folded.indexOf('NEEDS YOU'));
  sidebar.tap('PROPOSED');
  expect(sidebar.visibleTexts(), 'no card opens on its own').not.toContain('Drafts the reply with the quantities from the price list.');
  expect(
    between(sidebar.visibleTexts(), 'Reply to the supplier', 'Reproduce the rounding bug'),
    'a closed card shows why now under its badges'
  ).toEqual(['Reply to the supplier', '~5m', '🦉 Nova', 'due Fri', 'The supplier wrote two hours ago']);
  sidebar.tap('Reply to the supplier');
  const texts = sidebar.visibleTexts();
  expect(between(texts, 'Reply to the supplier', 'Reproduce the rounding bug')).toEqual([
    'Reply to the supplier',
    '~5m',
    '🦉 Nova',
    'due Fri',
    'The supplier wrote two hours ago',
    '“Can you confirm the spring order by Friday?”',
    'Drafts the reply with the quantities from the price list.',
    'Drafts the email and sends nothing.',
    'Start',
    'Later',
    'Skip'
  ]);
  expect(texts, 'the second card starts closed').not.toContain('Runs the checkout with the totals from the issue.');
  expect(texts).not.toContain('Tidy the release notes');
  expect(texts).not.toContain('Run the sync');
});

run('Start types the choice into the agent’s heartbeat, and the card stays until the published ledger drops it', () => {
  const sidebar = mount(installed(), CMUX_DATA);
  sidebar.tap('PROPOSED');
  sidebar.tap('Reply to the supplier');
  expect(sidebar.tap('Start')).toEqual({
    kind: 'cmux',
    method: 'surface.send_text',
    params: { surface_id: 'w-nova-s2-surface', workspace_id: 'w-nova', text: '/proposal start p-a1 --workspace=w-nova\n' }
  });
  expect(sidebar.visibleTexts(), 'a Start that fails leaves the card where it was').toContain('Reply to the supplier');
  const decided = { ...NOVA_ENTRY, proposals: NOVA_ENTRY.proposals.filter(({ id }) => id !== 'p-a1') };
  const redrawn = mount(installed({ [NOVA_HOME]: decided }), CMUX_DATA);
  redrawn.tap('PROPOSED');
  expect(redrawn.visibleTexts()).not.toContain('Reply to the supplier');
  expect(redrawn.visibleTexts(), 'the next card stays closed').not.toContain('Runs the checkout with the totals from the issue.');
});

run('a card put off with Later shows once the clock passes its time', () => {
  const sidebar = mount(installed(), CMUX_DATA);
  sidebar.tap('PROPOSED');
  expect(sidebar.visibleTexts()).not.toContain('Tidy the release notes');
  sidebar.setData({ clock: { ...CMUX_DATA.clock, epoch: CMUX_DATA.clock.epoch + 2 * 60 * 60 } });
  expect(sidebar.visibleTexts()).toContain('Tidy the release notes');
});

const novaHeartbeatAgents = (change: (agents: (typeof CMUX_DATA.workspaces)[number]['agents']) => (typeof CMUX_DATA.workspaces)[number]['agents']) => ({
  ...CMUX_DATA,
  workspaces: CMUX_DATA.workspaces.map((item) => (item.id === 'w-nova' ? { ...item, agents: change(item.agents) } : item))
});

run('another agent started in the heartbeat’s old tab is not the heartbeat, and keeps its Manager card', () => {
  const codex = novaHeartbeatAgents((agents) =>
    agents.map((agent) => (agent.panelId === 'w-nova-s2-panel' ? { ...agent, kind: 'codex' } : agent))
  );
  const sidebar = mount(installed(), codex);
  expect(sidebar.visibleTexts()).toContain('Morning brief');
  sidebar.tap('PROPOSED');
  expect(sidebar.visibleTexts()).toContain('Start Nova’s heartbeat');
  expect(sidebar.visibleTexts()).not.toContain('Start');
});

run('a heartbeat tab moved to another workspace gets the choice where it is now', () => {
  const [nova, code, ...rest] = CMUX_DATA.workspaces;
  const heartbeatTab = nova?.tabs.find((tab) => tab.surfaceId === 'w-nova-s2-surface');
  const heartbeatAgent = nova?.agents.find((agent) => agent.panelId === 'w-nova-s2-panel');
  if (!nova || !code || !heartbeatTab || !heartbeatAgent) {
    throw new Error('the fixture lost its heartbeat tab');
  }
  const moved = {
    ...CMUX_DATA,
    workspaces: [
      { ...nova, tabs: nova.tabs.filter((tab) => tab !== heartbeatTab), agents: nova.agents.filter((agent) => agent !== heartbeatAgent) },
      { ...code, tabs: [...code.tabs, heartbeatTab], agents: [...code.agents, heartbeatAgent] },
      ...rest
    ]
  };
  const sidebar = mount(installed(), moved);
  sidebar.tap('PROPOSED');
  sidebar.tap('Reply to the supplier');
  expect(sidebar.tap('Start')?.params).toMatchObject({ surface_id: 'w-nova-s2-surface', workspace_id: 'w-code' });
});

run('a heartbeat tab whose Claude has ended or gone offers a new heartbeat, and no buttons', () => {
  const ended = novaHeartbeatAgents((agents) =>
    agents.map((agent) => (agent.panelId === 'w-nova-s2-panel' ? { ...agent, status: 'ended' as const } : agent))
  );
  const gone = novaHeartbeatAgents((agents) => agents.filter((agent) => agent.panelId !== 'w-nova-s2-panel'));
  [ended, gone].forEach((data) => {
    const sidebar = mount(installed(), data);
    sidebar.tap('PROPOSED');
    const texts = sidebar.visibleTexts();
    expect(texts).toContain('Start Nova’s heartbeat');
    expect(texts).not.toContain('Start');
  });
});

run('a home whose heartbeat isn’t open in cmux shows its proposals with how to start them, and no buttons', () => {
  const gone = { ...NOVA_ENTRY, heartbeat: { surfaceId: 'closed-surface', workspaceId: 'w-nova' } };
  const sidebar = mount(installed({ [NOVA_HOME]: gone }), CMUX_DATA);
  sidebar.tap('PROPOSED');
  sidebar.tap('Reply to the supplier');
  const texts = sidebar.visibleTexts();
  expect(texts).toContain('Run /heartbeat in one of Nova’s sessions to start these.');
  expect(texts).not.toContain('Start');
  const scout = mount(installed({ [SCOUT_HOME]: SCOUT_ENTRY }), CMUX_DATA);
  scout.tap('PROPOSED');
  scout.tap('Audit the dark mode colours');
  expect(scout.visibleTexts()).toContain('Run /heartbeat in one of Scout’s sessions to start these.');
  expect(() => scout.tap('Start')).toThrow();
});

const HEARTBEAT_LINE =
  'Opens a session in Scout’s home that looks for proposals now, then every 55 minutes while the home’s other sessions are active, keeping the best five showing, and refreshes the brain every 6 hours when there’s something new.';

run('a home without a heartbeat gets a card that opens one in a focused tab of the selected workspace', () => {
  const sidebar = mount(installed({ [SCOUT_HOME]: SCOUT_ENTRY }), CMUX_DATA);
  sidebar.tap('PROPOSED');
  sidebar.tap('Start Scout’s heartbeat');
  expect(between(sidebar.visibleTexts(), 'Start Scout’s heartbeat', 'Audit the dark mode colours')).toEqual([
    'Start Scout’s heartbeat',
    '🐢 Scout',
    HEARTBEAT_LINE,
    'Start heartbeat'
  ]);
  expect(sidebar.tap('Start heartbeat')).toEqual({
    kind: 'cmux',
    method: 'surface.create',
    params: { workspace_id: 'w-nova', working_directory: SCOUT_HOME, initial_input: 'claude "/heartbeat"\r', focus: 'true' }
  });
  expect(sidebar.visibleTexts(), 'the card stays until the rewrite drops it').toContain('Start Scout’s heartbeat');
  const billed = mount(installed({ [SCOUT_HOME]: { ...SCOUT_ENTRY, launcher: 'agent' } }), selecting('w-code'));
  billed.tap('PROPOSED');
  billed.tap('Start Scout’s heartbeat');
  expect(billed.tap('Start heartbeat')?.params).toEqual({
    workspace_id: 'w-code',
    working_directory: SCOUT_HOME,
    initial_input: 'agent "/heartbeat"\r',
    focus: 'true'
  });
});

run('a home path with an apostrophe goes to cmux as the folder, never through the shell', () => {
  const home = join('/Users', 'ada', "Ada's Agents", 'Scout');
  const sidebar = mount(installed({ [home]: { ...SCOUT_ENTRY, home } }), CMUX_DATA);
  sidebar.tap('PROPOSED');
  sidebar.tap('Start Scout’s heartbeat');
  expect(sidebar.tap('Start heartbeat')?.params).toMatchObject({ working_directory: home, initial_input: 'claude "/heartbeat"\r' });
});

run('with no workspace selected, or a remote one, the heartbeat opens in a new workspace in its home', () => {
  const remote = {
    ...CMUX_DATA,
    workspaces: CMUX_DATA.workspaces.map((item) =>
      item.selected ? { ...item, remote: { target: 'ada@build-box', state: 'connected', connected: true } } : item
    )
  };
  [selecting('none'), remote].forEach((data) => {
    const sidebar = mount(installed({ [SCOUT_HOME]: SCOUT_ENTRY }), data);
    sidebar.tap('PROPOSED');
    sidebar.tap('Start Scout’s heartbeat');
    expect(sidebar.tap('Start heartbeat')).toEqual({
      kind: 'cmux',
      method: 'workspace.create',
      params: { cwd: SCOUT_HOME, initial_input: 'claude "/heartbeat"\r' }
    });
  });
});

run('with no heartbeat reachable, PROPOSED starts folded too, and the header opens it', () => {
  const gone = { ...NOVA_ENTRY, heartbeat: null };
  const sidebar = mount(installed({ [NOVA_HOME]: gone, [SCOUT_HOME]: SCOUT_ENTRY }), CMUX_DATA);
  const texts = sidebar.visibleTexts();
  expect(texts).toContain('PROPOSED');
  expect(texts).not.toContain('Start Scout’s heartbeat');
  expect(texts).not.toContain('Reply to the supplier');
  sidebar.tap('PROPOSED');
  expect(sidebar.visibleTexts()).toEqual(expect.arrayContaining(['Start Nova’s heartbeat', 'Start Scout’s heartbeat']));
});

run('a reachable heartbeat adds no card to start it', () => {
  const sidebar = mount(installed({ [NOVA_HOME]: NOVA_ENTRY, [SCOUT_HOME]: SCOUT_ENTRY }), CMUX_DATA);
  sidebar.tap('PROPOSED');
  expect(sidebar.visibleTexts()).toContain('Reply to the supplier');
  expect(sidebar.visibleTexts()).not.toContain('Start Nova’s heartbeat');
});

run('PROPOSED shows with no proposals anywhere while a home has no heartbeat', () => {
  const sidebar = mount(installed({ [SCOUT_HOME]: { ...SCOUT_ENTRY, proposals: [] } }), CMUX_DATA);
  expect(sidebar.visibleTexts()).toContain('PROPOSED');
  sidebar.tap('PROPOSED');
  expect(sidebar.visibleTexts()).toContain('Start Scout’s heartbeat');
});

run('every joined agent’s proposals share the section, the ones a heartbeat can decide first', () => {
  const sidebar = mount(installed({ [SCOUT_HOME]: SCOUT_ENTRY, [NOVA_HOME]: NOVA_ENTRY }), CMUX_DATA);
  sidebar.tap('PROPOSED');
  const texts = sidebar.visibleTexts();
  const titles = [
    'Reply to the supplier',
    'Reproduce the rounding bug',
    'Start Scout’s heartbeat',
    'Audit the dark mode colours'
  ];
  expect(
    texts.filter((text) => titles.includes(text)),
    'Nova’s first, then Scout’s heartbeat card and its proposal'
  ).toEqual(titles);
  expect(texts).toContain('🐢 Scout');
});

run('an entry from an older plugin adds nothing to PROPOSED', () => {
  const texts = mount(installed({ [NOVA_HOME]: { ...NOVA_ENTRY, schema: 7 } }), CMUX_DATA).visibleTexts();
  expect(texts).not.toContain('PROPOSED');
  expect(texts).toContain('NEEDS YOU');
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

run('a task row in the Tasks card lets its project pill truncate, so its fixed-width line never widens the page', () => {
  const sidebar = onProjects();
  sidebar.tap('Tasks');
  const props = sidebar.propsOf('acme-app');
  expect(props).toMatchObject({ lineLimit: 1, truncation: 'tail' });
  expect(props?.fixedSize, 'a fixed pill is what widened the page').toBeUndefined();
});

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

run('a task beside other projects’ tasks names its project after its due words', () => {
  const sidebar = onProjects();
  sidebar.tap('Tasks');
  expect(between(sidebar.visibleTexts(), 'Ship the invoice export', 'THIS WEEK')).toEqual([
    'Ship the invoice export',
    'ac-101',
    'P1',
    'overdue 2d',
    'acme-app',
    '3'
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
    'Fix the checkout total'
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

run('Projects opens on what the tasks add up to and when it was written, and an entry without one shows none', () => {
  const texts = onProjects().visibleTexts();
  expect(texts.slice(texts.indexOf('TASKS AT A GLANCE · 2H AGO'), texts.indexOf('TASKS AT A GLANCE · 2H AGO') + 2)).toEqual([
    'TASKS AT A GLANCE · 2H AGO',
    'Checkout fixes lead this week: a total bug due tomorrow and an overdue invoice export. Launch waits on both.'
  ]);
  expect(
    onProjects().propsOf(
      'Checkout fixes lead this week: a total bug due tomorrow and an overdue invoice export. Launch waits on both.'
    ),
    'however long the written theme, the banner stops at three lines'
  ).toMatchObject({ lineLimit: 3, truncation: 'tail' });
  expect(onProjects({ [NOVA_HOME]: { ...NOVA_ENTRY, tasksSummary: null } }).visibleTexts().join(' ')).not.toContain(
    'TASKS AT A GLANCE'
  );
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
    'Fix the checkout total',
    'ac-102',
    'P0',
    'due tomorrow',
    'Ship the invoice export',
    'ac-101',
    'P1',
    'overdue 2d',
    '3',
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
  const sidebar = onProjects({ [NOVA_HOME]: NOVA_ENTRY, [SCOUT_HOME]: SCOUT_ENTRY });
  expect(sidebar.visibleTexts()).toEqual(expect.arrayContaining(['🦉 Nova', '🐢 Scout']));
  sidebar.tap('🐢 Scout');
  expect(sidebar.visibleTexts()).toContain('No projects yet.');
  expect(sidebar.visibleTexts()).not.toContain('acme-app');
});

run('the agent the sidebar shows lights its chip in its own color; the others stay grey', () => {
  const sidebar = onProjects({ [NOVA_HOME]: NOVA_ENTRY, [SCOUT_HOME]: SCOUT_ENTRY });
  expect(sidebar.propsOf('🦉 Nova')).toMatchObject({ color: '#2F7FC1', background: '#2F7FC13d' });
  expect(sidebar.propsOf('🐢 Scout')).toMatchObject({
    color: 'secondary',
    background: '#7f7f7f1f',
    hoverBackground: '#C7354B3d'
  });
  sidebar.tap('🐢 Scout');
  expect(sidebar.propsOf('🐢 Scout')).toMatchObject({ color: '#C7354B', background: '#C7354B3d' });
  expect(sidebar.propsOf('🦉 Nova')).toMatchObject({ color: 'secondary' });
});

run('an entry from before agents had colors lights its chip grey', () => {
  expect(onProjects({ [NOVA_HOME]: { ...NOVA_ENTRY, colors: undefined } }).propsOf('🦉 Nova')).toMatchObject({
    color: 'primary',
    background: '#7f7f7f3d'
  });
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
  const cards = ['Pinned', 'Today', 'Yesterday', 'Mon 2 Nov'];
  expect(texts.filter((text) => cards.includes(text))).toEqual(cards);
  const titles = [
    'Support playbook',
    'Morning brief — Mon 9 Nov',
    'Checkpoints — 4 sessions',
    'Evening wrap — Sun 8 Nov'
  ];
  expect(
    texts.filter((text) => titles.includes(text)),
    'pins first, then today and yesterday, newest first'
  ).toEqual(titles);
  expect(texts, 'earlier days start folded').not.toContain('Pricing page plan');
  expect(texts).toEqual(
    expect.arrayContaining(['Launch checklist', 'Pricing page', 'acme-app', 'briefing', '8:30 AM', 'findings', 'clean'])
  );
  expect(texts).not.toContain('AT WORK');
});

run('a report opens as a full tab, and the dashboard icon sits on Projects only', () => {
  const sidebar = onReports();
  expect(sidebar.tap('Morning brief — Mon 9 Nov')).toEqual({
    kind: 'cmux',
    method: 'file.open',
    params: { path: join(NOVA_HOME, 'reports', 'briefings', '2026-11-09-0830-morning.md') }
  });
  expect(() => sidebar.tap('Dashboard')).toThrow();
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
  expect(sidebar.visibleTexts()).not.toContain('Pinned');
  sidebar.type('nothing like this');
  expect(sidebar.visibleTexts()).toContain('No matching reports.');
});

run('reports past the entry’s limit point to the dashboard', () => {
  const sidebar = onReports({ [NOVA_HOME]: { ...NOVA_ENTRY, olderReports: 3 } });
  expect(sidebar.tap('3 older reports are on the dashboard.')?.params).toEqual({
    url: `${NOVA_ENTRY.dashboard}#reports`
  });
});

const onRecent = (homes?: Record<string, HomeEntry>) => {
  const sidebar = onProjects(homes);
  sidebar.tap('Recent');
  return sidebar;
};

run('Recent lists the files changed lately by day, titled from the work model, with their kind and project', () => {
  const texts = onRecent().visibleTexts();
  const cards = ['Today', 'Yesterday', 'Tue 3 Nov'];
  expect(texts.filter((text) => cards.includes(text))).toEqual(cards);
  const titles = ['Ship the invoice export', 'Morning brief — Mon 9 Nov', 'Acme roadmap', 'Profile'];
  expect(texts.filter((text) => titles.includes(text)), 'newest first').toEqual(titles);
  expect(texts, 'earlier days start folded').not.toContain('Memory');
  expect(texts).toEqual(expect.arrayContaining(['task', 'briefing', 'roadmap', 'knowledge', 'acme-app', '9:40 AM']));
});

run('a recent file opens as a full tab', () => {
  const sidebar = onRecent();
  expect(sidebar.tap('Acme roadmap')?.params).toEqual({
    url: pathToFileURL(join(NOVA_HOME, 'projects', 'acme-app', 'roadmap.html')).href
  });
  expect(sidebar.tap('Ship the invoice export')).toEqual({
    kind: 'cmux',
    method: 'file.open',
    params: { path: join(NOVA_HOME, 'projects', 'acme-app', 'tasks', 'ac-101.md') }
  });
});

run('the recent search matches titles, kinds and projects, folded days included', () => {
  const sidebar = onRecent();
  sidebar.type('memory');
  expect(sidebar.visibleTexts()).toContain('Memory');
  expect(sidebar.visibleTexts()).not.toContain('Profile');
  sidebar.type('acme-app');
  expect(sidebar.visibleTexts()).toEqual(expect.arrayContaining(['Ship the invoice export', 'Acme roadmap']));
  expect(sidebar.visibleTexts()).not.toContain('Profile');
  sidebar.type('nothing like this');
  expect(sidebar.visibleTexts()).toContain('No matching files.');
});

run('Recent says when nothing changed, and asks an older agent for an update', () => {
  expect(onRecent({ [NOVA_HOME]: { ...NOVA_ENTRY, recent: [] } }).visibleTexts()).toContain(
    'Nothing changed in the last 30 days.'
  );
  const { recent: _left, ...older } = NOVA_ENTRY;
  expect(onRecent({ [NOVA_HOME]: older }).visibleTexts()).toContain('Update Nova to see its recent files.');
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
  sidebar.tap('Mon 2 Nov');
  expect(sidebar.visibleTexts()).toEqual(expect.arrayContaining(['8:30 AM', '7:10 AM', '9:00 PM', '2:20 PM']));
  sidebar.tap('Today');
  expect(sidebar.visibleTexts()).not.toContain('Morning brief — Mon 9 Nov');
  expect(sidebar.visibleTexts()).toContain('Evening wrap — Sun 8 Nov');
  sidebar.tap('Today');
  expect(sidebar.visibleTexts()).toContain('Morning brief — Mon 9 Nov');
  sidebar.tap('Pinned');
  expect(sidebar.visibleTexts()).not.toContain('Support playbook');
  expect(sidebar.visibleTexts()).toContain('Pinned');
});

const onGoals = (homes?: Record<string, HomeEntry>) => {
  const sidebar = onProjects(homes);
  sidebar.tap('Goals');
  return sidebar;
};

run('Goals leads with the year’s theme, then today, this week, this month and this year', () => {
  const texts = onGoals().visibleTexts();
  expect(texts.slice(0, texts.indexOf('Today')).slice(-2)).toEqual(['2026 THEME', 'Make the shop run itself']);
  const cards = ['Today', 'This week', 'This month', 'This year'];
  expect(texts.filter((text) => cards.includes(text))).toEqual(cards);
});

run('a goal reads as its number and project, its headline, what counts as done, and the block’s notes', () => {
  const texts = onGoals().visibleTexts();
  expect(between(texts, 'This week', 'This month')).toEqual([
    'This week',
    '2',
    'Set for the week of 2 Nov · ask Nova: goals week',
    '1',
    'acme-app',
    "The invoice export in customers' hands (ac-101)",
    'DONE WHEN',
    'exported files open in the accounting tool for two customers',
    '2',
    'garden-shop',
    'The spring range photographed (gs-202)',
    'DONE WHEN',
    'every product has three photos',
    'Set Monday for a full week.'
  ]);
  expect(between(texts, 'This month', 'This year')).toEqual(
    expect.arrayContaining([
      'November 2026',
      "Acme's invoices go out on their own",
      'added 11-05: the release notes ride along'
    ])
  );
});

run('this year starts folded and opens to every quarter, the scored ones included', () => {
  const sidebar = onGoals();
  expect(sidebar.visibleTexts()).not.toContain('🧾 Invoices without hands');
  sidebar.tap('This year');
  expect(sidebar.visibleTexts()).toEqual(
    expect.arrayContaining(['Q3', '✅', '🧾 Checkout rebuilt: the old flow is gone', 'Q4', '🧾 Invoices without hands'])
  );
});

run('yesterday’s daily goals leave today empty, with the command that sets them', () => {
  const blocks = NOVA_ENTRY.goals.blocks.map((block) =>
    block.horizon === 'day' ? { ...block, date: '2026-11-08' } : block
  );
  const texts = onGoals({ [NOVA_HOME]: { ...NOVA_ENTRY, goals: { ...NOVA_ENTRY.goals, blocks } } }).visibleTexts();
  expect(between(texts, 'Today', 'This week')).toEqual([
    'Today',
    '0',
    'No goals set for today.',
    'Ask Nova: goals day'
  ]);
});

run('Goals leaves the dashboard and roadmap icons to Projects, so the section chips keep the row', () => {
  const sidebar = onGoals();
  expect(() => sidebar.tap('Dashboard')).toThrow();
  expect(() => sidebar.tap('Roadmap')).toThrow();
});

run('the Discuss icon on a task or a goal opens a session about it, and the task row still opens its file', () => {
  const sidebar = onProjects();
  sidebar.tap('acme-app');
  const discussed = sidebar.tap('Discuss with Nova');
  expect(discussed).toMatchObject({
    method: 'surface.create',
    params: { workspace_id: 'w-nova', working_directory: NOVA_HOME, focus: 'true' }
  });
  const lastTask = between(sidebar.visibleTexts(), 'acme-app', 'BLOCKED')
    .filter((text) => /^ac-\d{3}$/.test(text))
    .at(-1);
  expect(discussed?.params?.initial_input).toBe(`claude "/agentlayer:discuss task:${lastTask}"\r`);
  expect(sidebar.tap('Fix the checkout total')?.method).toBe('file.open');
  expect(onGoals().tap('Discuss with Nova')?.params?.initial_input, 'the last goal shown: this month, the second').toBe(
    'claude "/agentlayer:discuss goal:month:2"\r'
  );
});

run("a session opens in its own agent's workspace, focused, never in another joined agent's, even the selected one", () => {
  const both = { [NOVA_HOME]: NOVA_ENTRY, [SCOUT_HOME]: SCOUT_ENTRY };
  const fromElsewhere = mount(installed(both), selecting('w-other'));
  fromElsewhere.tap('PROPOSED');
  fromElsewhere.tap('Reply to the supplier');
  expect(fromElsewhere.tap('Start')?.params?.text, "Nova's own workspace, though Downloads is selected").toBe(
    '/proposal start p-a1 --workspace=w-nova\n'
  );
  const discussing = onProjects(both);
  discussing.tap('acme-app');
  discussing.tap('Discuss with Nova');
  expect(discussing.actions.slice(-2).map(({ method, params }) => [method, params?.workspace_id])).toEqual([
    ['workspace.select', 'w-nova'],
    ['surface.create', 'w-nova']
  ]);
  const scout = mount(installed(both), selecting('w-nova'));
  scout.tap('PROPOSED');
  scout.tap('Start Scout’s heartbeat');
  expect(scout.tap('Start heartbeat')?.method, "Nova's workspace is selected, and Scout has none of its own").toBe(
    'workspace.create'
  );
});

run('NOTES opens while a note is unread, and its buttons type the choice into the heartbeat', () => {
  const notes: NoteLedger = {
    notes: [
      {
        id: 'n-1',
        at: nowISO(new Date()),
        source: 'site:pricing',
        lens: 'public-drift',
        title: 'The pricing page still shows last year',
        body: 'The page lists the old plans.',
        sources: ['https://example.com/pricing'],
        next: 'Update the pricing table.',
        prompt: 'Update it, then stop.',
        reaction: ''
      }
    ]
  };
  const sidebar = mount(installed({ [NOVA_HOME]: homeEntry(NOVA_HOME, NOVA, { ...NOVA_STATE, notes }) }), CMUX_DATA);
  expect(sidebar.visibleTexts(), 'open on its own, since the note is unread').toContain('The pricing page still shows last year');
  sidebar.tap('The pricing page still shows last year');
  expect(sidebar.tap('Useful')?.params?.text).toBe('/note useful n-1\n');
  expect(sidebar.tap('Start')?.params?.text, "in Nova's own workspace").toBe('/note start n-1 --workspace=w-nova\n');
  const read = homeEntry(NOVA_HOME, NOVA, {
    ...NOVA_STATE,
    notes: { notes: notes.notes.map((note) => ({ ...note, reaction: 'dismissed' as const })) }
  });
  expect(read.notes, 'a dismissed note leaves').toEqual([]);
});

run('a preview can open on any page, while the installed sidebar opens on the Manager', () => {
  const own = { version: '1.1.0', bundle: readFileSync(DIST, 'utf8') };
  const opened = mount(previewText(own, { tab: 'agents', section: 'goals' }), CMUX_DATA).visibleTexts();
  expect(opened).toEqual(expect.arrayContaining(['This week', 'This month']));
  expect(mount(installed(), CMUX_DATA).visibleTexts()[0]).toBe('Manager');
});

run('a preview can open with the Tasks card and a project already unfolded', () => {
  const own = { version: '1.1.0', bundle: readFileSync(DIST, 'utf8') };
  const page = { tab: 'agents', section: 'projects' } as const;
  const folded = mount(previewText(own, page)).visibleTexts();
  const unfolded = mount(previewText(own, { ...page, expanded: ['tasks', 'support-desk'] })).visibleTexts();
  expect(folded).not.toContain('IN FLIGHT');
  expect(folded).not.toContain('Publish the refunds FAQ');
  expect(unfolded).toEqual(expect.arrayContaining(['IN FLIGHT', 'Publish the refunds FAQ']));
});
