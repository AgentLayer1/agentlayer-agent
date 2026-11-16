import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nameHue } from '@/status/html-primitives';
import { homeEntry, REPORT_LIMIT } from './entry';
import { NOVA, NOVA_HOME, SCOUT, SCOUT_HOME } from './preview/fixture';
import { SCHEMA } from './sidebar/data';

const url = (...parts: string[]) => pathToFileURL(join(...parts)).href;
const taskPath = (project: string, id: string) => join(NOVA_HOME, 'projects', project, 'tasks', `${id}.md`);

test('a home’s projects, at work first, each with its live tasks in the order they need you', () => {
  const entry = homeEntry(NOVA_HOME, NOVA);
  expect(entry).toMatchObject({
    schema: SCHEMA,
    name: 'Nova',
    emoji: '🦉',
    dashboard: url(NOVA_HOME, 'dashboard.html'),
    roadmap: url(NOVA_HOME, 'roadmap.html')
  });
  expect(entry.projects.map((project) => project.slug)).toEqual(['acme-app', 'garden-shop', 'blog']);
  expect(entry.projects[0]).toEqual({
    slug: 'acme-app',
    hue: 210,
    active: 1,
    open: 2,
    blocked: 0,
    done: 5,
    roadmap: url(NOVA_HOME, 'projects', 'acme-app', 'roadmap.html'),
    pins: [
      {
        title: 'Launch checklist',
        icon: '✅',
        target: { kind: 'file', path: join(NOVA_HOME, 'projects', 'acme-app', 'launch-checklist.md') }
      },
      {
        title: 'Pricing page',
        icon: '📊',
        target: { kind: 'page', url: url(NOVA_HOME, 'reports', 'plans', 'pricing.html') }
      }
    ],
    tasks: [
      {
        id: 'ac-101',
        title: 'Ship the invoice export',
        status: 'active',
        priority: 'P1',
        due: '2026-11-07',
        comments: 3,
        path: taskPath('acme-app', 'ac-101')
      },
      {
        id: 'ac-102',
        title: 'Fix the checkout total',
        status: 'open',
        priority: 'P0',
        due: '2026-11-10',
        comments: 0,
        path: taskPath('acme-app', 'ac-102')
      },
      {
        id: 'ac-103',
        title: 'Write the release notes',
        status: 'open',
        priority: 'P2',
        due: '2026-12-01',
        comments: 0,
        path: taskPath('acme-app', 'ac-103')
      }
    ]
  });
  expect(
    entry.projects[1]?.tasks.map((task) => task.id),
    'blocked before open'
  ).toEqual(['gs-201', 'gs-202']);
  expect(entry.projects[2]).toMatchObject({ done: 2, roadmap: null, pins: [], tasks: [] });
});

test('a home with no projects or roadmap', () => {
  expect(homeEntry(SCOUT_HOME, SCOUT)).toMatchObject({ name: 'Scout', roadmap: null, projects: [] });
});

test('the same projects and tasks in another order give the same entry', () => {
  const shuffled = { ...NOVA, projects: NOVA.projects.toReversed(), tasks: NOVA.tasks.toReversed() };
  expect(homeEntry(NOVA_HOME, shuffled)).toEqual(homeEntry(NOVA_HOME, NOVA));
});

test('closed and archived tasks count as done and never show as rows', () => {
  const archived = { ...NOVA.tasks[0], id: 'ac-099', status: 'done', archived: true };
  const card = homeEntry(NOVA_HOME, { ...NOVA, tasks: [...NOVA.tasks, archived] }).projects[0];
  expect(card?.done).toBe(6);
  expect(card?.tasks.map((task) => task.id)).not.toContain('ac-099');
});

test('a path with a space becomes a URL a browser can open', () => {
  expect(homeEntry(join('/Users', 'ada', 'My Agents', 'Nova'), NOVA).dashboard).toBe(
    'file:///Users/ada/My%20Agents/Nova/dashboard.html'
  );
});

test('the newest reports, each with the kind and hue the dashboard gives it, and the home pins', () => {
  const entry = homeEntry(NOVA_HOME, NOVA);
  expect(entry.reports.map((item) => [item.date, item.time, item.kind, item.status])).toEqual([
    ['2026-11-09', '08:30', 'briefing', '🟠'],
    ['2026-11-09', '07:10', 'attention', ''],
    ['2026-11-08', '21:00', 'briefing', '🟢'],
    ['2026-11-02', '14:20', 'plans', '⏳']
  ]);
  expect(entry.reports[0]).toMatchObject({
    hue: nameHue('briefing'),
    target: { kind: 'file', path: join(NOVA_HOME, 'reports', 'briefings', '2026-11-09-0830-morning.md') }
  });
  expect(entry.pins).toEqual([
    {
      title: 'Support playbook',
      icon: '🛟',
      target: { kind: 'file', path: join(NOVA_HOME, 'reports', 'plans', 'support-playbook.md') }
    }
  ]);
  expect(entry.olderReports).toBe(0);
});

test('reports past the limit are counted, not carried, and an HTML report opens as a page', () => {
  const many = Array.from({ length: REPORT_LIMIT + 3 }, (_unused, index) => ({
    date: '2026-10-01',
    time: String(index).padStart(2, '0') + ':00',
    title: `Report ${index}`,
    path: join('reports', 'plans', `r-${index}.html`),
    skill: '',
    status: '',
    category: 'plans'
  }));
  const entry = homeEntry(NOVA_HOME, { ...NOVA, reports: many });
  expect(entry.reports).toHaveLength(REPORT_LIMIT);
  expect(entry.olderReports).toBe(3);
  expect(entry.reports[0]?.target).toEqual({ kind: 'page', url: url(NOVA_HOME, 'reports', 'plans', 'r-0.html') });
});
