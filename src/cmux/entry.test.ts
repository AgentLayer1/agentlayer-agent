import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homeEntry } from './entry';
import { fixtureEntry, NOVA, SCOUT } from './preview/fixture';
import { SCHEMA } from './sidebar/data';

const NOVA_HOME = NOVA.runtime.home;
const url = (...parts: string[]) => pathToFileURL(join(...parts)).href;

test('a home with projects, pins and a roadmap', () => {
  expect(fixtureEntry(NOVA)).toEqual({
    schema: SCHEMA,
    name: 'Nova',
    emoji: '🦉',
    launcher: 'claude',
    dashboard: url(NOVA_HOME, 'dashboard.html'),
    roadmap: url(NOVA_HOME, 'roadmap.html'),
    projects: [
      { slug: 'acme-app', hue: 210, readme: join(NOVA_HOME, 'projects', 'acme-app', 'README.md') },
      { slug: 'blog', hue: expect.any(Number), readme: join(NOVA_HOME, 'projects', 'blog', 'README.md') },
      { slug: 'garden-shop', hue: expect.any(Number), readme: join(NOVA_HOME, 'projects', 'garden-shop', 'README.md') }
    ],
    pinned: [
      { title: 'Support playbook', kind: 'md', target: join(NOVA_HOME, 'reports', 'plans', 'support-playbook.md') },
      { title: 'Q4 review', kind: 'html', target: url(NOVA_HOME, 'reports', 'briefings', 'q4-review.html') }
    ]
  });
});

test('a home with no projects, pins or roadmap', () => {
  expect(fixtureEntry(SCOUT, 'agent')).toMatchObject({
    name: 'Scout',
    launcher: 'agent',
    roadmap: null,
    projects: [],
    pinned: []
  });
});

test('a projects folder moved out of the home is where the READMEs are read from', () => {
  const elsewhere = join('/Volumes', 'shared', 'projects');
  expect(homeEntry(NOVA, { launcher: 'claude', projectsDir: elsewhere }).projects[0]?.readme).toBe(
    join(elsewhere, 'acme-app', 'README.md')
  );
});

test('what changes through a session leaves the entry as it was', () => {
  const later = {
    ...NOVA,
    runtime: { ...NOVA.runtime, time: '16:42', generatedAt: '2026-01-05T16:42:00+08:00' },
    sessions: [{ id: 'later-session' }],
    tasks: {
      byProject: [
        { project: 'blog', open: 4, updatedAt: '2026-01-05' },
        { project: 'garden-shop', open: 1, updatedAt: '2026-01-04' },
        { project: 'acme-app', open: 9, updatedAt: '2026-01-03' }
      ],
      queue: [{ id: 'ac-101' }]
    }
  };
  expect(fixtureEntry(later)).toEqual(fixtureEntry(NOVA));
});

test('a project page in the surfaces is not the home roadmap', () => {
  const projectPageOnly = { ...NOVA, surfaces: [{ href: join(NOVA_HOME, 'projects', 'acme-app', 'roadmap.html') }] };
  expect(fixtureEntry(projectPageOnly).roadmap).toBeNull();
});

test('a path with a space becomes a URL a browser can open', () => {
  const spaced = { ...NOVA, runtime: { home: join('/Users', 'ada', 'My Agents', 'Nova') } };
  expect(fixtureEntry(spaced).dashboard).toBe('file:///Users/ada/My%20Agents/Nova/dashboard.html');
});

test('a pin given relative to the home becomes absolute, and a pin that is neither markdown nor HTML is left out', () => {
  const pins = {
    ...NOVA,
    pinned: [
      { title: 'Notes', href: 'reports/notes.md' },
      { title: 'Scan', href: 'reports/scan.pdf' }
    ]
  };
  expect(fixtureEntry(pins).pinned).toEqual([
    { title: 'Notes', kind: 'md', target: join(NOVA_HOME, 'reports', 'notes.md') }
  ]);
});
