/*
 * The lively made-up setup behind the preview and its screenshots: three agents, each with its own workspace and three
 * more for its kinds of work, as a real Mac running several agents looks. The tests use the smaller fixture.ts, whose
 * exact texts they assert; this one is for looking at. The cmux data (the Manager's sessions) and the demo window's
 * groups and workspaces both come from AGENTS, so the two sides of a screenshot tell one story.
 */
import { join } from 'node:path';
import type { Heartbeat } from '@/heartbeat/ledger';
import type { ProposalLedger } from '@/proposals/ledger';
import type { HomeState } from '../entry';
import { parseGoals } from '@/work/goals';
import { DEFAULT_AGENT_COLORS } from '@/shared/persona';
import { WORK_SCHEMA, type Work } from '@/work/model';
import { closed, NOVA_GOALS, NOVA_HOME, NOW, project, proposal, report, SCOUT_HOME, task } from './fixture';

export const OPPI_HOME = join('/Users', 'ada', 'Documents', 'Agents', 'Oppi');

type Status = 'needs_input' | 'working' | 'idle' | 'ended';

interface ShowcaseSession {
  id: string;
  title: string;
  status: Status;
  /**
   * The latest thing asked of it, which the Manager's card shows under the title.
   */
  prompt: string;
  minutesAgo: number;
  branch?: string;
  subagents?: string[];
  unread?: boolean;
}

export interface ShowcaseWorkspace {
  id: string;
  title: string;
  /**
   * What the left sidebar shows under the workspace's name.
   */
  description: string;
  sessions: ShowcaseSession[];
}

export interface ShowcaseAgent {
  name: string;
  emoji: string;
  home: string;
  /**
   * The colour of its workspaces: a hex for the Manager's chip, a cmux colour name for the demo's left sidebar.
   */
  color: { hex: string; named: string };
  workspaces: ShowcaseWorkspace[];
}

export const AGENTS: readonly ShowcaseAgent[] = [
  {
    name: 'Oppi',
    emoji: '🐙',
    home: OPPI_HOME,
    color: { hex: '#C62828', named: 'Red' },
    workspaces: [
      {
        id: 'w-oppi',
        title: 'Agent Oppi',
        description: 'Two refund tickets wait on your reply; the brief is ready',
        sessions: [
          {
            id: 'support-sweep',
            title: 'Support sweep',
            status: 'needs_input',
            prompt: 'Two refund tickets wait on your reply',
            minutesAgo: 4
          },
          { id: 'morning-brief', title: 'Morning brief', status: 'idle', prompt: 'Brief me', minutesAgo: 90 }
        ]
      },
      {
        id: 'w-support',
        title: 'Support Desk',
        description: 'Drafting replies for the partial refund tickets',
        sessions: [
          {
            id: 'refund-replies',
            title: 'refund-replies',
            status: 'working',
            prompt: 'Draft a reply for each partial refund ticket',
            minutesAgo: 1,
            subagents: ['Read the ticket history', 'Check the refund policy', 'Draft the replies']
          },
          {
            id: 'faq',
            title: 'Partial refunds FAQ',
            status: 'idle',
            prompt: 'Turn the answers into an FAQ entry',
            minutesAgo: 35,
            unread: true
          }
        ]
      },
      {
        id: 'w-billing',
        title: 'Billing',
        description: 'Planning the move to the new invoice provider',
        sessions: [
          {
            id: 'invoice-migration',
            title: 'invoice-migration-plan',
            status: 'working',
            prompt: 'Map every invoice field to the new provider',
            minutesAgo: 3,
            branch: 'feat/new-provider'
          }
        ]
      },
      {
        id: 'w-onboarding',
        title: 'Onboarding',
        description: 'Welcome pack for the three new customers',
        sessions: [
          {
            id: 'welcome-pack',
            title: 'Welcome pack',
            status: 'idle',
            prompt: 'Send the welcome pack to this week’s new customers',
            minutesAgo: 50,
            unread: true
          }
        ]
      }
    ]
  },
  {
    name: 'Nova',
    emoji: '🦄',
    home: NOVA_HOME,
    color: { hex: '#1565C0', named: 'Blue' },
    workspaces: [
      {
        id: 'w-nova',
        title: 'Agent Nova',
        description: 'Month-end close: two receipts missing',
        sessions: [
          {
            id: 'month-end',
            title: 'Month-end close',
            status: 'needs_input',
            prompt: 'Two receipts are missing for October',
            minutesAgo: 25
          }
        ]
      },
      {
        id: 'w-investors',
        title: 'Investor Update',
        description: 'November update, numbers in',
        sessions: [
          {
            id: 'investor-update',
            title: 'November investor update',
            status: 'working',
            prompt: 'Add the revenue chart and send me the draft',
            minutesAgo: 6
          }
        ]
      },
      {
        id: 'w-expenses',
        title: 'Expenses',
        description: 'Receipts filed for the week',
        sessions: [
          {
            id: 'receipts',
            title: 'File the receipts',
            status: 'idle',
            prompt: 'File this week’s receipts',
            minutesAgo: 180
          }
        ]
      },
      {
        id: 'w-contracts',
        title: 'Contracts',
        description: 'Office lease renewal, comments sent',
        sessions: [
          {
            id: 'lease',
            title: 'Office lease renewal',
            status: 'idle',
            prompt: 'Mark up the renewal and send it to the landlord',
            minutesAgo: 240
          }
        ]
      }
    ]
  },
  {
    name: 'Scout',
    emoji: '🦀',
    home: SCOUT_HOME,
    color: { hex: '#2E7D32', named: 'Green' },
    workspaces: [
      {
        id: 'w-scout',
        title: 'Agent Scout',
        description: 'Standup notes for the acme-app team',
        sessions: [
          {
            id: 'standup',
            title: 'Standup',
            status: 'idle',
            prompt: 'What did the team ship yesterday?',
            minutesAgo: 120
          }
        ]
      },
      {
        id: 'w-checkout',
        title: 'acme-app',
        description: 'Fixing the checkout total, tests running',
        sessions: [
          {
            id: 'checkout-total',
            title: 'Fix the checkout total',
            status: 'working',
            prompt: 'Round the tax per line, then total',
            minutesAgo: 2,
            branch: 'fix/checkout-total',
            subagents: ['Run the checkout tests', 'Compare against last month']
          }
        ]
      },
      {
        id: 'w-reviews',
        title: 'Code Reviews',
        description: 'PR 412 is ready for your call',
        sessions: [
          { id: 'pr-412', title: 'PR 412', status: 'needs_input', prompt: 'Review PR 412', minutesAgo: 12 },
          {
            id: 'pr-409',
            title: 'PR 409',
            status: 'ended',
            prompt: 'Review PR 409',
            minutesAgo: 300
          }
        ]
      },
      {
        id: 'w-mobile',
        title: 'Mobile App',
        description: 'Dark mode audit, two screens left',
        sessions: [
          {
            id: 'dark-mode',
            title: 'Dark mode audit',
            status: 'working',
            prompt: 'Fix the contrast on the settings and profile screens',
            minutesAgo: 9,
            branch: 'fix/dark-mode'
          }
        ]
      }
    ]
  }
];

const agentNamed = (name: string): ShowcaseAgent => {
  const agent = AGENTS.find((item) => item.name === name);
  if (!agent) {
    throw new Error(`the showcase has no agent ${name}`);
  }
  return agent;
};

const session = (workspace: string, home: string, spec: ShowcaseSession) => {
  const panelId = `${workspace}-${spec.id}-panel`;
  const at = NOW - spec.minutesAgo * 60;
  return {
    tab: {
      id: panelId,
      surfaceId: `${workspace}-${spec.id}-surface`,
      title: spec.title,
      focused: false,
      pinned: false,
      hasUnread: spec.unread ?? false,
      directory: home,
      latestPrompt: spec.prompt,
      latestAt: at,
      ...(spec.branch ? { branch: spec.branch, dirty: true } : {})
    },
    agent: {
      id: `${workspace}-${spec.id}`,
      kind: 'claude',
      name: 'Claude Code',
      status: spec.status,
      lastActivityAt: at,
      sinceEpoch: at,
      title: spec.title,
      panelId,
      directory: home,
      ...(spec.subagents
        ? {
            children: spec.subagents.map((label, index) => ({
              id: `${workspace}-${spec.id}-child-${index}`,
              running: true,
              label,
              startedEpoch: at - (index + 1) * 40
            }))
          }
        : {})
    }
  };
};

/**
 * cmux's data for the preview: every agent's workspaces and sessions, with Agent Oppi's selected, so the Agents tab
 * opens on Oppi. cmux 0.65.2's right sidebar gets no workspace groups, so neither does the preview.
 */
export const SHOWCASE_CMUX_DATA = {
  workspaces: AGENTS.flatMap(({ home, color, workspaces }) =>
    workspaces.map(({ id, title, sessions }) => {
      const built = sessions.map((spec) => session(id, home, spec));
      return {
        id,
        title,
        color: color.hex,
        selected: id === 'w-oppi',
        pinned: false,
        index: 0,
        directory: home,
        ports: [],
        portCount: 0,
        unread: built.filter(({ tab }) => tab.hasUnread).length,
        status: 'working',
        tabs: built.map(({ tab }) => tab),
        tabCount: built.length,
        agents: built.map(({ agent }) => agent).toSorted((a, b) => b.lastActivityAt - a.lastActivityAt)
      };
    })
  ),
  clock: { hour: 10, minute: 0, second: 0, weekday: 1, epoch: NOW }
};

const pin = (title: string, icon: string, ...path: string[]) => ({ title, icon, path: join(...path) });

/**
 * Oppi's work: six projects in every state (three at work, one blocked, two quiet), tasks from overdue to someday,
 * reports across four days, pins, and goals set for this week.
 */
export const SHOWCASE_OPPI: Work = {
  schema: WORK_SCHEMA,
  agent: { name: 'Oppi', emoji: agentNamed('Oppi').emoji, colors: DEFAULT_AGENT_COLORS },
  roadmap: 'roadmap.html',
  projects: [
    project('acme-app', 210, {
      roadmap: join('projects', 'acme-app', 'roadmap.html'),
      pins: [
        pin('Launch checklist', '✅', 'projects', 'acme-app', 'launch-checklist.md'),
        pin('Pricing page', '📊', 'reports', 'plans', 'pricing.html')
      ]
    }),
    project('billing-migration', 280),
    project('blog', 40),
    project('docs-site', 190),
    project('garden-shop', 120),
    project('support-desk', 330, { pins: [pin('Refund macros', '💬', 'projects', 'support-desk', 'macros.md')] })
  ],
  tasks: [
    task('acme-app', 'ac-101', 'Ship the invoice export', 'active', 'P1', '2026-11-07', 3),
    task('acme-app', 'ac-102', 'Fix the checkout total', 'open', 'P0', '2026-11-10'),
    task('acme-app', 'ac-103', 'Write the release notes', 'open', 'P2', '2026-12-01'),
    task('support-desk', 'sd-201', 'Answer the partial refund tickets', 'active', 'P1', '2026-11-09', 2),
    task('support-desk', 'sd-202', 'Publish the refunds FAQ', 'open', 'P2'),
    task('billing-migration', 'bm-301', 'Move invoices to the new provider', 'active', 'P2', '2026-11-20'),
    task('garden-shop', 'gs-201', 'Wait on the supplier price list', 'blocked', 'P2'),
    task('garden-shop', 'gs-202', 'Photograph the spring range', 'open', 'P3'),
    task('docs-site', 'ds-401', 'Refresh the getting-started guide', 'open', 'P3'),
    ...closed('acme-app', 5),
    ...closed('support-desk', 3),
    ...closed('billing-migration', 1),
    ...closed('garden-shop', 4),
    ...closed('blog', 6),
    ...closed('docs-site', 2)
  ],
  reports: [
    report('2026-11-09', '09:40', 'Support sweep: two tickets need you', 'helpdesk', 'helpdesk', 'findings'),
    report('2026-11-09', '09:15', 'Review: PR 412, checkout rounding', 'reviews', 'engineer', 'clean'),
    report('2026-11-09', '08:30', 'Morning brief — Mon 9 Nov', 'briefings', 'briefing', 'findings'),
    report('2026-11-09', '07:10', 'Checkpoints — 4 sessions', 'radar', 'attention', ''),
    report('2026-11-08', '21:00', 'Evening wrap — Sun 8 Nov', 'briefings', 'briefing', 'clean'),
    report('2026-11-08', '16:05', 'Adversarial review: partial refunds', 'reviews', 'adversarial-review', 'critical'),
    report('2026-11-08', '14:20', 'Pricing page plan', 'plans', '', 'draft'),
    report('2026-11-06', '17:00', 'Week ahead: goals and plan', 'briefings', 'goals', 'clean'),
    report('2026-11-06', '12:30', 'Slack pulse: launch channel', 'slack', 'slack', 'findings')
  ],
  pins: [
    pin('Support playbook', '🛟', 'reports', 'plans', 'support-playbook.md'),
    pin('Q4 roadmap review', '🗺️', 'reports', 'plans', 'q4-roadmap.md')
  ],
  goals: parseGoals(NOVA_GOALS.replace('Week of Monday, 2026-11-02', 'Week of Monday, 2026-11-09')),
  tasksSummary: {
    text: 'Launch week leans on the reconciliation report and the load-test prep; the pricing page waits on the new plans.',
    writtenAt: new Date((NOW - 90 * 60) * 1000).toISOString()
  },
  malformed: []
};

const quietHome = (name: string, projects: Work['projects'], tasks: Work['tasks']): Work => ({
  schema: WORK_SCHEMA,
  agent: { name, emoji: agentNamed(name).emoji, colors: { primary: '#2F7FC1', accent: '#E0664A' } },
  roadmap: '',
  projects,
  tasks,
  reports: [],
  pins: [],
  goals: [],
  tasksSummary: null,
  malformed: []
});

export const SHOWCASE_SCOUT = quietHome(
  'Scout',
  [project('checkout-api', 100), project('mobile-app', 260)],
  [
    task('checkout-api', 'ca-11', 'Fix the checkout total', 'active', 'P0', '2026-11-10'),
    task('checkout-api', 'ca-12', 'Review PR 412', 'open', 'P1', '2026-11-09'),
    task('mobile-app', 'ma-21', 'Audit the dark mode colours', 'open', 'P3'),
    ...closed('checkout-api', 3)
  ]
);

export const SHOWCASE_NOVA = quietHome(
  'Nova',
  [project('month-end', 30), project('investor-update', 220)],
  [
    task('month-end', 'me-31', 'Chase the two missing receipts', 'active', 'P1', '2026-11-09'),
    task('investor-update', 'iu-41', 'Send the November update', 'open', 'P2', '2026-11-14'),
    ...closed('month-end', 8)
  ]
);

/**
 * What Oppi has ready, its heartbeat the Morning brief tab in its own workspace.
 */
export const SHOWCASE_OPPI_LEDGER: ProposalLedger = {
  proposals: [
    proposal('p-o1', 'Finish the reply to the accountant', {
      trigger: 'The accountant wrote two hours ago',
      quote: 'Was the October transfer a loan or salary?',
      detail: 'The draft answers the other question. This one is yours, so the session asks you first.',
      reach: 'Drafts the email and sends nothing.',
      due: 'due Sat'
    }),
    proposal('p-o2', 'Reproduce the silent alarm', {
      trigger: 'A new issue came in this afternoon',
      quote: 'The time is right but no sound plays.',
      detail: 'Runs it on the simulator and drafts a reply on the issue. No fix yet.',
      reach: 'Reads the repo and posts nothing.',
      estimate: '15m'
    }),
    proposal('p-o3', 'Run the sync', {
      trigger: 'The last sync was three days ago',
      detail: 'Nine sessions haven’t been compiled into the brain yet.',
      reach: 'Writes to the brain.',
      estimate: '4m'
    })
  ]
};

export const SHOWCASE_OPPI_HEARTBEAT: Heartbeat = {
  owner: 'oppi-heartbeat',
  everyMinutes: 55,
  places: [{ adapter: 'cmux', surfaceId: 'w-oppi-morning-brief-surface', workspaceId: 'w-oppi' }]
};

export const SHOWCASE_OPPI_STATE: Partial<HomeState> = {
  proposals: SHOWCASE_OPPI_LEDGER,
  heartbeat: SHOWCASE_OPPI_HEARTBEAT
};

/**
 * What Nova has ready, its heartbeat the month-end tab.
 */
export const SHOWCASE_NOVA_LEDGER: ProposalLedger = {
  proposals: [
    proposal('p-n1', 'Put tomorrow’s call on one page', {
      trigger: 'You have a call tomorrow at 10:30',
      detail: 'What’s still open, today’s email, and three questions to ask.',
      reach: 'Writes one report.'
    })
  ]
};

export const SHOWCASE_NOVA_HEARTBEAT: Heartbeat = {
  owner: 'nova-heartbeat',
  everyMinutes: 55,
  places: [{ adapter: 'cmux', surfaceId: 'w-nova-month-end-surface', workspaceId: 'w-nova' }]
};

export const SHOWCASE_NOVA_STATE: Partial<HomeState> = {
  proposals: SHOWCASE_NOVA_LEDGER,
  heartbeat: SHOWCASE_NOVA_HEARTBEAT
};
