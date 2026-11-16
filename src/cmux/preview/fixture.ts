import { join } from 'node:path';
import { parseGoals } from '@/work/goals';
import { WORK_SCHEMA, type Work, type WorkReport, type WorkTask } from '@/work/model';

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

const report = (
  date: string,
  time: string,
  title: string,
  category: string,
  skill: string,
  status: string
): WorkReport => ({
  date,
  time,
  title,
  path: join('reports', category, `${date}-${time.replace(':', '')}-${title.split(' ')[0]?.toLowerCase()}.md`),
  skill,
  status,
  category
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

// The goal blocks as the goals skill writes them into TASKS.md. The week was set for the week before the clock's.
export const NOVA_GOALS = `<!-- GOALS:START -->
## Daily Goals — 2026-11-09

1. Ship the invoice export to staging (ac-101)

## Weekly Goals — Week of Monday, 2026-11-02

1. acme-app: the invoice export in customers' hands (ac-101) — exported files open in the accounting tool for two customers
2. garden-shop: the spring range photographed (gs-202) — every product has three photos

_Set Monday for a full week._

## Monthly Goals

_November 2026 · set 2026-11-01 · acme first_

1. **Acme's invoices go out on their own** _(success: by 11-30 every invoice is exported without a manual step)_ · added 11-05: the release notes ride along
2. **The garden shop's spring range is live** _(success: by 11-30 the range is listed with photos)_

_Not doing in November: the blog redesign._

## Yearly Goals

_2026 theme: Make the shop run itself · planned 2026-01-05_

- **Q3** ✅ — 🧾 Checkout rebuilt: the old flow is gone
- **Q4** — 🧾 Invoices without hands _(check: by 12-31 no invoice needs a manual step)_
- **Q1 2027** — 🌱 Spring launch _(check: by 03-31 the range sells online)_

_Foundations: the books closed every month._
<!-- GOALS:END -->`;

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
  reports: [
    report('2026-11-09', '08:30', 'Morning brief — Mon 9 Nov', 'briefings', 'briefing', 'findings'),
    report('2026-11-09', '07:10', 'Checkpoints — 4 sessions', 'radar', 'attention', ''),
    report('2026-11-08', '21:00', 'Evening wrap — Sun 8 Nov', 'briefings', 'briefing', 'clean'),
    report('2026-11-02', '14:20', 'Pricing page plan', 'plans', '', 'draft'),
    { date: '2026-11-01', time: '09:00', title: 'A line with no link', path: '', skill: '', status: '', category: '' }
  ],
  pins: [{ title: 'Support playbook', icon: '🛟', path: join('reports', 'plans', 'support-playbook.md') }],
  goals: parseGoals(NOVA_GOALS),
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
  goals: [],
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
