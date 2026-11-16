import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homeEntry } from './entry';
import { NOVA, SCOUT } from './preview/fixture';
import { SCHEMA } from './sidebar/data';

const NOVA_HOME = NOVA.runtime.home;
const url = (...parts: string[]) => pathToFileURL(join(...parts)).href;
const taskPath = (project: string, id: string) => join(NOVA_HOME, 'projects', project, 'tasks', `${id}.md`);

test('a home’s projects, at work first, each with its live tasks in the order they need you', () => {
  const entry = homeEntry(NOVA);
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
  expect(entry.projects[2]).toMatchObject({ roadmap: null, pins: [], tasks: [] });
});

test('a home with no projects or roadmap', () => {
  expect(homeEntry(SCOUT)).toMatchObject({ name: 'Scout', roadmap: null, projects: [] });
});

test('the same projects and tasks in another order, with per-session fields beside them, give the same entry', () => {
  const shuffled = {
    ...NOVA,
    runtime: { ...NOVA.runtime, time: '16:42', generatedAt: '2026-01-05T16:42:00+08:00' },
    sessions: [{ id: 'later-session' }],
    tasks: {
      byProject: [...NOVA.tasks.byProject].reverse().map((load) => ({ ...load, updatedAt: '2026-01-05' })),
      queue: [...NOVA.tasks.queue].reverse(),
      touchedToday: [{ id: 'ac-101' }]
    }
  };
  expect(homeEntry(shuffled)).toEqual(homeEntry(NOVA));
});

test('a project page in the surfaces is not the home roadmap', () => {
  const projectPageOnly = { ...NOVA, surfaces: [{ href: join(NOVA_HOME, 'projects', 'acme-app', 'roadmap.html') }] };
  expect(homeEntry(projectPageOnly).roadmap).toBeNull();
});

test('a path with a space becomes a URL a browser can open', () => {
  const spaced = { ...NOVA, runtime: { home: join('/Users', 'ada', 'My Agents', 'Nova') } };
  expect(homeEntry(spaced).dashboard).toBe('file:///Users/ada/My%20Agents/Nova/dashboard.html');
});
