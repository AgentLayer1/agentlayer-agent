import { FILES, FOLDERS, MCP_PREFIX, PLUGIN_NAME } from '@/config';
import { relative } from 'node:path';

/**
 * Every optional pack the configure-skills skill sets up, in the order it shows them: what each
 * gives the operator, the configure section that walks it, and what a home holds once it's set up.
 * init, configure-skills and seed read this; nothing else lists the packs.
 */

export const PackGroup = {
  Web: 'Web & research',
  Code: 'Code',
  Support: 'Support & people',
  Workspace: 'Your workspace',
  Extend: 'Extend'
} as const;
export type PackGroup = (typeof PackGroup)[keyof typeof PackGroup];

/** What a pack's detector reads: the home's settings and files, and what the secret store holds. */
export interface Probe {
  allow: ReadonlySet<string>;
  deny: ReadonlySet<string>;
  env: Readonly<Record<string, string>>;
  /** Whether a secret-store key holds a value. */
  key: (name: string) => boolean;
  /** The OAuth sign-ins the secret store holds. */
  signedIn: ReadonlySet<'google' | 'slack'>;
  /** The connections each pack's own code finds: GitHub tokens, databases, helpdesk logins. */
  connections: Readonly<Record<'github' | 'database' | 'helpdesk', number>>;
  mcpServers: readonly string[];
  /** True when a path under the home exists. */
  exists: (path: string) => boolean;
  /** A third-party skill library is linked into `.claude/skills/`. */
  libraries: boolean;
  cmuxJoined: boolean;
  /** Each finances entity, and whether a company one lists its accounts. */
  finances: readonly { slug: string; company: boolean; accounts: boolean }[];
  macos: boolean;
  cmuxApp: boolean;
  /** This session runs in a cmux terminal. */
  inCmux: boolean;
  /** Each other host: whether its CLI answers here, and whether the agent is wired into it. */
  hosts: Readonly<Record<'codex' | 'antigravity', { installed: boolean; wired: boolean }>>;
}

/** One thing a set-up pack has; an optional part never holds a pack back from set up. */
export interface Part {
  label: string;
  ok: boolean;
  optional?: boolean;
}

export interface PackDef {
  label: string;
  group: PackGroup;
  blurb: string;
  /** The configure-skills section that sets it up (its heading starts with this). */
  walk: string;
  /** Whether configure-skills can take it out again (its C.2 entry is `**<label> deconfigure:**`). */
  removable: boolean;
  /** Whether this machine can run it; every machine when absent. */
  available?: (probe: Probe) => boolean;
  /** Whether setup offers it first; never when absent. */
  recommended?: (probe: Probe) => boolean;
  parts: (probe: Probe) => Part[];
  /** Grants the walk adds to `permissions.allow`; seed carries them with the pack. */
  grants?: string[];
  denies?: string[];
  /** Secret key names the pack's tools read, for a seed recipient to fill in. */
  secretKeys?: string[];
  /** Non-secret keys the walk plants in settings.local.json `env`. */
  settingsEnv?: string[];
}

export const mcp = (names: string[]): string[] => names.map((name) => `${MCP_PREFIX}${name}`);
const granted = (probe: Probe, grants: string[]): boolean => grants.every((grant) => probe.allow.has(grant));
const anyGranted = (probe: Probe, grants: string[]): boolean => grants.some((grant) => probe.allow.has(grant));
const hasEnv = (probe: Probe, key: string): boolean => (probe.env[key] ?? '').trim() !== '';

const SEO = mcp([
  'serpapi_search',
  'open_page_rank',
  'gsc_inspect',
  'gsc_query',
  'gsc_sites',
  'google_auth',
  'page_speed_audit',
  'page_speed_psi'
]);
const PLAYWRIGHT = mcp(['browser_screenshot', 'browser_pdf', 'browser_markdown', 'browser_record', 'browser_flows']);
const DATABASE = mcp(['database_list', 'database_query', 'database_schema', 'database_fork']);
const GITHUB = mcp([
  'github_fast_forward',
  'github_pr_list',
  'github_pr_view',
  'github_pr_comments',
  'github_pr_diff',
  'github_pr_checks',
  'github_run_list',
  'github_run_view',
  'github_run_log',
  'github_issue_list',
  'github_issue_view',
  'github_sweep',
  'github_issue_create',
  'github_issue_comment',
  'github_issue_update',
  'github_pr_update',
  'github_comment_update'
]);
const HELPDESK_READ = mcp([
  'helpdesk_connections',
  'helpdesk_tickets',
  'helpdesk_ticket',
  'helpdesk_attachment',
  'helpdesk_accounts',
  'helpdesk_lookups',
  'helpdesk_stats'
]);
const HELPDESK_DRAFT = mcp(['helpdesk_note', 'helpdesk_assign']);
const SLACK = [
  ...mcp([
    'slack_whoami',
    'slack_channels',
    'slack_history',
    'slack_batch_history',
    'slack_thread',
    'slack_search',
    'slack_waiting'
  ]),
  'WebFetch(domain:slack.com)',
  `Skill(${PLUGIN_NAME}:slack)`
];

/** MCP servers a pack registers in `.mcp.json`, so they don't count as the operator's own. */
const PACK_SERVERS = ['xcode'];

export const PACKS = {
  browser: {
    label: 'Browser',
    group: PackGroup.Web,
    blurb: 'screenshots, PDFs and page text from any site, scripted flows, optional Perplexity search',
    walk: 'A.2b',
    removable: true,
    // Playwright works with no key, and search falls back to the built-in web search.
    recommended: () => true,
    parts: (probe) => [
      { label: 'browser tool permissions', ok: granted(probe, PLAYWRIGHT) },
      {
        label: 'Perplexity search key',
        ok: granted(probe, mcp(['web_search'])) && probe.key('PERPLEXITY_API_KEY'),
        optional: true
      }
    ],
    grants: [...mcp(['web_search']), ...PLAYWRIGHT],
    secretKeys: ['PERPLEXITY_API_KEY']
  },
  seo: {
    label: 'SEO',
    group: PackGroup.Web,
    blurb: 'site audits, Search Console, PageSpeed, live Google results and domain authority',
    walk: 'A.2a',
    removable: true,
    parts: (probe) => [
      { label: 'SEO tool permissions', ok: anyGranted(probe, SEO) },
      { label: 'site URL (GSC_SITE_URL)', ok: hasEnv(probe, 'GSC_SITE_URL'), optional: true },
      { label: 'Google sign-in', ok: probe.signedIn.has('google'), optional: true },
      { label: 'SerpAPI key', ok: probe.key('SERPAPI_KEY'), optional: true },
      { label: 'Open PageRank key', ok: probe.key('OPENPAGERANK_API_KEY'), optional: true }
    ],
    grants: SEO,
    secretKeys: ['SERPAPI_KEY', 'OPENPAGERANK_API_KEY'],
    settingsEnv: ['GSC_SITE_URL']
  },
  notes: {
    label: 'Notes',
    group: PackGroup.Web,
    blurb: 'the heartbeat sends up to three checked findings a day, from public facts you approve',
    walk: 'A.2k',
    removable: true,
    parts: (probe) => [
      { label: 'approved public facts (knowledge/public.md)', ok: probe.exists(relative(FOLDERS.HOME, FILES.PUBLIC)) },
      { label: 'scouting turned on (AGENT_NOTES_SCOUT)', ok: probe.env.AGENT_NOTES_SCOUT === 'true' }
    ]
  },
  github: {
    label: 'GitHub',
    group: PackGroup.Code,
    blurb: 'PRs, issues and CI runs: reviews, replies, walkthroughs, and keeping your checkouts current',
    walk: 'A.2d',
    removable: true,
    // Without a token, sync never fast-forwards the operator's checkouts and the agent reads stale code.
    recommended: (probe) => hasEnv(probe, 'AGENT_CODE_PATH'),
    parts: (probe) => [
      { label: 'GitHub tool permissions', ok: granted(probe, GITHUB) },
      { label: 'gh kept out of the shell', ok: probe.deny.has('Bash(gh *)') },
      { label: 'a GitHub token', ok: probe.connections.github > 0 }
    ],
    grants: GITHUB,
    denies: ['Bash(gh)', 'Bash(gh *)'],
    secretKeys: ['GITHUB_TOKEN']
  },
  database: {
    label: 'Database',
    group: PackGroup.Code,
    blurb: 'read-only Postgres queries and schema, and a private copy of a local database for risky work',
    walk: 'A.2c',
    removable: true,
    parts: (probe) => [
      { label: 'database tool permissions', ok: granted(probe, DATABASE) },
      { label: 'a database connection (an AGENT_DB_ key)', ok: probe.connections.database > 0 }
    ],
    grants: DATABASE
  },
  api: {
    label: 'API',
    group: PackGroup.Code,
    blurb: 'API requests drafted as Bruno, Postman or curl collections you send yourself',
    walk: 'A.2e',
    removable: false,
    parts: (probe) => [
      {
        label: 'a collection folder (reports/api/)',
        ok: ['bruno', 'postman', 'curl'].some((adapter) => probe.exists(`reports/api/${adapter}`))
      }
    ]
  },
  xcode: {
    label: 'Xcode',
    group: PackGroup.Code,
    blurb: "build, test, run and debug Apple apps through Xcode's own MCP server",
    walk: 'A.2f',
    removable: true,
    available: (probe) => probe.macos,
    parts: (probe) => [
      { label: 'the xcode server in .mcp.json', ok: probe.mcpServers.includes('xcode') },
      { label: 'Xcode tool permissions', ok: probe.allow.has('mcp__xcode__*') },
      { label: 'the Xcode rules (.claude/rules/xcode.md)', ok: probe.exists('.claude/rules/xcode.md') }
    ],
    grants: ['mcp__xcode__*']
  },
  codex: {
    label: 'Codex',
    group: PackGroup.Code,
    blurb: "this agent in OpenAI's Codex too: the same brain, skills, tools and home rules",
    walk: 'A.2m',
    removable: false,
    available: (probe) => probe.hosts.codex.installed,
    parts: (probe) => [{ label: 'wired into this home (.codex/)', ok: probe.hosts.codex.wired }]
  },
  antigravity: {
    label: 'Antigravity',
    group: PackGroup.Code,
    blurb: "this agent in Google's Antigravity too: the same brain, skills, tools and home rules",
    walk: 'A.2n',
    removable: false,
    available: (probe) => probe.hosts.antigravity.installed,
    parts: (probe) => [{ label: 'the plugin in ~/.gemini/config/plugins.json', ok: probe.hosts.antigravity.wired }]
  },
  helpdesk: {
    label: 'Helpdesk',
    group: PackGroup.Support,
    blurb: 'read SupportCandy or Pylon tickets and leave private draft notes; a person sends every reply',
    walk: 'A.2g',
    removable: true,
    parts: (probe) => [
      { label: 'helpdesk tool permissions', ok: granted(probe, HELPDESK_READ) },
      { label: 'a helpdesk login', ok: probe.connections.helpdesk > 0 },
      { label: 'draft notes and assigning', ok: granted(probe, HELPDESK_DRAFT), optional: true }
    ],
    grants: [...HELPDESK_READ, ...HELPDESK_DRAFT],
    secretKeys: ['SUPPORTCANDY_APP_PASSWORD', 'PYLON_API_TOKEN'],
    settingsEnv: ['SUPPORTCANDY_URL', 'SUPPORTCANDY_USERNAME']
  },
  appstore: {
    label: 'App Store',
    group: PackGroup.Support,
    blurb: "read any app's App Store reviews; read-only, never replies",
    walk: 'A.2h',
    removable: true,
    parts: (probe) => [{ label: 'the reviews tool permission', ok: granted(probe, mcp(['appstore_reviews'])) }],
    grants: mcp(['appstore_reviews'])
  },
  slack: {
    label: 'Slack',
    group: PackGroup.Support,
    blurb: 'read-only Slack through your account: pulses, replies you owe, threads waiting on you',
    walk: 'A.2i',
    removable: true,
    parts: (probe) => [
      { label: 'Slack tool permissions', ok: granted(probe, SLACK) },
      { label: 'a Slack app (AGENT_SLACK_CLIENT_ID)', ok: hasEnv(probe, 'AGENT_SLACK_CLIENT_ID') },
      { label: 'signed in to Slack', ok: probe.signedIn.has('slack') }
    ],
    grants: SLACK,
    settingsEnv: ['AGENT_SLACK_CLIENT_ID']
  },
  cmux: {
    label: 'cmux',
    group: PackGroup.Workspace,
    blurb: "the AgentLayer sidebar in cmux: every session by what needs you, each agent's tasks and pages",
    walk: 'A.2j',
    removable: true,
    available: (probe) => probe.cmuxApp,
    recommended: (probe) => probe.inCmux,
    parts: (probe) => [{ label: 'this home in the cmux sidebar', ok: probe.cmuxJoined }]
  },
  finances: {
    label: 'Finances',
    group: PackGroup.Workspace,
    blurb: 'tax deadlines and books for your companies and you, statements, spending by category',
    walk: 'A.2l',
    removable: false,
    parts: (probe) => [
      { label: 'a profile per company and for you (projects/finances/entities/)', ok: probe.finances.length > 0 },
      ...probe.finances
        .filter((entity) => entity.company)
        .map((entity) => ({ label: `${entity.slug}'s bank accounts`, ok: entity.accounts })),
      { label: 'categorising rules (RULES.md)', ok: probe.exists('projects/finances/RULES.md'), optional: true }
    ]
  },
  libraries: {
    label: 'Third-party libraries',
    group: PackGroup.Extend,
    blurb: 'skill libraries others publish (SEO/GEO, marketing playbooks), linked into .claude/skills/',
    walk: 'F',
    removable: true,
    parts: (probe) => [{ label: 'a library linked', ok: probe.libraries }]
  },
  mcp: {
    label: 'Remote MCP servers',
    group: PackGroup.Extend,
    blurb: "another service's MCP server, behind a hardened wrapper in .mcp.json",
    walk: 'B',
    removable: false,
    parts: (probe) => [
      {
        label: 'a server in .mcp.json',
        ok: probe.mcpServers.some((name) => !PACK_SERVERS.includes(name))
      }
    ]
  }
} satisfies Record<string, PackDef>;

export type PackId = keyof typeof PACKS;

export const PackState = { New: 'new', Partial: 'partial', Ready: 'ready' } as const;
export type PackState = (typeof PackState)[keyof typeof PackState];

export interface PackStatus extends Pick<PackDef, 'label' | 'group' | 'blurb' | 'walk' | 'removable'> {
  id: PackId;
  available: boolean;
  /** Offered first, and only while it isn't set up. */
  recommended: boolean;
  state: PackState;
  /** The required parts still missing. */
  missing: string[];
  /** The optional parts still off. */
  optional: string[];
}

/** A pack is new when it has none of its parts, set up when it has every required one, and half-done between. */
export const statusOf = (id: PackId, probe: Probe): PackStatus => {
  const def: PackDef = PACKS[id];
  const parts = def.parts(probe);
  const off = (optional: boolean): string[] =>
    parts.filter((part) => !part.ok && (part.optional === true) === optional).map((part) => part.label);
  const state = !parts.some((part) => part.ok)
    ? PackState.New
    : off(false).length === 0
      ? PackState.Ready
      : PackState.Partial;
  return {
    id,
    label: def.label,
    group: def.group,
    blurb: def.blurb,
    walk: def.walk,
    removable: def.removable,
    available: def.available?.(probe) ?? true,
    recommended: state !== PackState.Ready && (def.recommended?.(probe) ?? false),
    state,
    missing: state === PackState.New ? [] : off(false),
    optional: state === PackState.New ? [] : off(true)
  };
};

export const packIds = (): PackId[] => Object.keys(PACKS).filter((id): id is PackId => id in PACKS);
