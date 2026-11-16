import { join } from 'node:path';
import { WORK_SCHEMA, type Work, type WorkTask } from '@/work/model';

export const NOVA_HOME = join('/Users', 'ada', 'Documents', 'Agents', 'Nova');
export const SCOUT_HOME = join('/Users', 'ada', 'Documents', 'Agents', 'Scout');

const task = (
  project: string,
  id: string,
  title: string,
  status: string,
  priority: string,
  due = '',
  comments = 0
): WorkTask => ({
  id,
  title,
  project,
  status,
  priority,
  due,
  horizon: '',
  updated: '2026-11-08',
  closed: status === 'done' ? '2026-11-01' : '',
  assignee: [],
  dependsOn: [],
  blockedBy: '',
  issue: '',
  comments,
  archived: false,
  path: join('projects', project, 'tasks', `${id}.md`)
});

const closed = (project: string, count: number): WorkTask[] =>
  Array.from({ length: count }, (_unused, index) =>
    task(project, `${project}-done-${index}`, 'Done work', 'done', 'P3')
  );

const project = (slug: string, hue: number, pages: Partial<Work['projects'][number]> = {}) => ({
  slug,
  hue,
  description: '',
  roadmap: '',
  attention: '',
  pins: [],
  ...pages
});

/**
 * An invented home with a roadmap and three projects: one at work (with its own roadmap and pins), one blocked, one
 * quiet. The fixture's clock reads 9 Nov 2026, so the due dates cover overdue, tomorrow and later.
 */
export const NOVA: Work = {
  schema: WORK_SCHEMA,
  agent: { name: 'Nova', emoji: '🦉' },
  roadmap: 'roadmap.html',
  projects: [
    project('acme-app', 210, {
      roadmap: join('projects', 'acme-app', 'roadmap.html'),
      pins: [
        { title: 'Launch checklist', icon: '✅', path: join('projects', 'acme-app', 'launch-checklist.md') },
        { title: 'Pricing page', icon: '📊', path: join('reports', 'plans', 'pricing.html') }
      ]
    }),
    project('blog', 40),
    project('garden-shop', 120)
  ],
  tasks: [
    task('acme-app', 'ac-103', 'Write the release notes', 'open', 'P2', '2026-12-01'),
    task('garden-shop', 'gs-201', 'Wait on the supplier price list', 'blocked', 'P2'),
    task('acme-app', 'ac-101', 'Ship the invoice export', 'active', 'P1', '2026-11-07', 3),
    task('garden-shop', 'gs-202', 'Photograph the spring range', 'open', 'P3'),
    task('acme-app', 'ac-102', 'Fix the checkout total', 'open', 'P0', '2026-11-10'),
    ...closed('acme-app', 5),
    ...closed('garden-shop', 4),
    ...closed('blog', 2)
  ],
  reports: [],
  pins: [],
  malformed: []
};

/**
 * An invented home with no projects or roadmap.
 */
export const SCOUT: Work = {
  schema: WORK_SCHEMA,
  agent: { name: 'Scout', emoji: '🐢' },
  roadmap: '',
  projects: [],
  tasks: [],
  reports: [],
  pins: [],
  malformed: []
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
