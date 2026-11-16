import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { homeEntry } from './entry';
import { NOVA, SCOUT } from './preview/fixture';
import { SCHEMA } from './sidebar/data';

const NOVA_HOME = NOVA.runtime.home;

test('a home with projects, pins and a roadmap', () => {
  expect(homeEntry(NOVA, 'claude')).toEqual({
    schema: SCHEMA,
    name: 'Nova',
    emoji: '🦉',
    launcher: 'claude',
    roadmap: true,
    projects: [
      { slug: 'acme-app', hue: 210 },
      { slug: 'blog', hue: expect.any(Number) },
      { slug: 'garden-shop', hue: expect.any(Number) }
    ],
    pinned: [
      { title: 'Support playbook', path: join(NOVA_HOME, 'reports', 'plans', 'support-playbook.md'), kind: 'md' },
      { title: 'Q4 review', path: join(NOVA_HOME, 'reports', 'briefings', 'q4-review.html'), kind: 'html' }
    ]
  });
});

test('a home with no projects, pins or roadmap', () => {
  expect(homeEntry(SCOUT, 'agent')).toEqual({
    schema: SCHEMA,
    name: 'Scout',
    emoji: '🐢',
    launcher: 'agent',
    roadmap: false,
    projects: [],
    pinned: []
  });
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
  expect(homeEntry(later, 'claude')).toEqual(homeEntry(NOVA, 'claude'));
});

test('a project page in the surfaces is not the home roadmap', () => {
  const projectPageOnly = { ...NOVA, surfaces: [{ href: join(NOVA_HOME, 'projects', 'acme-app', 'roadmap.html') }] };
  expect(homeEntry(projectPageOnly, 'claude').roadmap).toBe(false);
});

test('a pin given relative to the home becomes absolute, and a pin that is neither markdown nor HTML is left out', () => {
  const pins = {
    ...NOVA,
    pinned: [
      { title: 'Notes', href: 'reports/notes.md' },
      { title: 'Scan', href: 'reports/scan.pdf' }
    ]
  };
  expect(homeEntry(pins, 'claude').pinned).toEqual([
    { title: 'Notes', path: join(NOVA_HOME, 'reports', 'notes.md'), kind: 'md' }
  ]);
});
