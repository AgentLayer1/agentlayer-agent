import { join } from 'node:path';
import type { EntrySource } from '../entry';

const NOVA_HOME = join('/Users', 'ada', 'Documents', 'Agents', 'Nova');
const SCOUT_HOME = join('/Users', 'ada', 'Documents', 'Agents', 'Scout');

const task = (project: string, id: string, title: string, status: string, priority: string, due = '') => ({
  id,
  title,
  status,
  priority,
  due,
  project,
  path: join('projects', project, 'tasks', `${id}.md`)
});

/**
 * An invented home with a roadmap and three projects: one at work, one blocked, one quiet. The fixture's clock
 * reads 9 Nov 2026, so the due dates cover overdue, tomorrow and later.
 */
export const NOVA: EntrySource = {
  runtime: { home: NOVA_HOME },
  persona: { name: 'Nova', emoji: '🦉' },
  projectHues: { 'acme-app': 210 },
  surfaces: [{ href: join(NOVA_HOME, 'roadmap.html') }, { href: 'projects/acme-app/dashboard.html' }],
  tasks: {
    byProject: [
      { project: 'garden-shop', active: 0, open: 1, blocked: 1, done: 4 },
      { project: 'acme-app', active: 1, open: 2, blocked: 0, done: 5 },
      { project: 'blog', active: 0, open: 0, blocked: 0, done: 2 }
    ],
    queue: [
      task('acme-app', 'ac-103', 'Write the release notes', 'open', 'P2', '2026-12-01'),
      task('garden-shop', 'gs-201', 'Wait on the supplier price list', 'blocked', 'P2'),
      task('acme-app', 'ac-101', 'Ship the invoice export', 'active', 'P1', '2026-11-07'),
      task('garden-shop', 'gs-202', 'Photograph the spring range', 'open', 'P3'),
      task('acme-app', 'ac-102', 'Fix the checkout total', 'open', 'P0', '2026-11-10')
    ]
  }
};

/**
 * An invented home with no projects or roadmap.
 */
export const SCOUT: EntrySource = {
  runtime: { home: SCOUT_HOME },
  persona: { name: 'Scout', emoji: '🐢' },
  projectHues: {},
  surfaces: [],
  tasks: { byProject: [], queue: [] }
};

const NOW = 1_794_218_400;

const session = (
  workspace: string,
  id: string,
  title: string,
  status: 'idle' | 'working' | 'needs_input' | 'ended',
  directory: string,
  minutesAgo: number
) => ({
  tab: {
    id: `${workspace}-${id}-panel`,
    surfaceId: `${workspace}-${id}-surface`,
    title,
    focused: false,
    pinned: false,
    hasUnread: false,
    directory
  },
  agent: {
    id: `${workspace}-${id}`,
    kind: 'claude',
    name: 'Claude Code',
    status,
    lastActivityAt: NOW - minutesAgo * 60,
    sinceEpoch: NOW - minutesAgo * 60,
    title,
    panelId: `${workspace}-${id}-panel`,
    directory
  }
});

const workspace = (
  id: string,
  title: string,
  directory: string,
  selected: boolean,
  sessions: ReturnType<typeof session>[]
) => ({
  id,
  title,
  selected,
  pinned: false,
  index: 0,
  directory,
  ports: [],
  portCount: 0,
  unread: 0,
  status: 'working',
  tabs: sessions.map((item) => item.tab),
  tabCount: sessions.length,
  agents: sessions.map((item) => item.agent)
});

const CODE_REPO = join('/Users', 'ada', 'Developer', 'acme-app');
const DOWNLOADS = join('/Users', 'ada', 'Downloads');

/**
 * cmux's data for the fixture: Nova's own workspace (selected), a code repo where Scout is working,
 * and a session outside any home.
 */
export const CMUX_DATA = {
  workspaces: [
    workspace('w-nova', 'Nova', NOVA_HOME, true, [
      session('w-nova', 's1', 'Support sweep', 'needs_input', NOVA_HOME, 4),
      session('w-nova', 's2', 'Morning brief', 'idle', NOVA_HOME, 30)
    ]),
    workspace('w-code', 'acme-app', CODE_REPO, false, [
      session('w-code', 's3', 'Fix the checkout total', 'working', SCOUT_HOME, 2)
    ]),
    workspace('w-other', 'Downloads', DOWNLOADS, false, [
      session('w-other', 's4', 'Rename the photos', 'idle', DOWNLOADS, 10)
    ])
  ],
  clock: { hour: 10, minute: 0, second: 0, weekday: 1, epoch: NOW }
};

export const selecting = (id: string) => ({
  ...CMUX_DATA,
  workspaces: CMUX_DATA.workspaces.map((item) => ({ ...item, selected: item.id === id }))
});
