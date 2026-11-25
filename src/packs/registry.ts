import { MCP_PREFIX, PLUGIN_NAME } from '@/config';

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

/** What a pack's detector reads: the home's settings, files and the secret store's key names. */
export interface Probe {
  allow: ReadonlySet<string>;
  deny: ReadonlySet<string>;
  env: Readonly<Record<string, string>>;
  /** Key names in `.state/secrets/.env`, plus the OAuth files present (`google/tokens`, `slack/tokens`). */
  secrets: ReadonlySet<string>;
  mcpServers: readonly string[];
  /** True when a path under the home exists. */
  exists: (path: string) => boolean;
  /** Third-party skill libraries linked into `.claude/skills/`. */
  libraries: number;
  /** This home's place in the cmux sidebar. */
  cmux: 'joined' | 'not-joined' | 'not-installed';
  /** Each finances entity, and whether a company one lists its accounts. */
  finances: readonly { slug: string; company: boolean; accounts: boolean }[];
  macos: boolean;
  cmuxApp: boolean;
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
  /** The section that takes it out, or null when there's nothing to take out. */
  remove: string | null;
  available: (probe: Probe) => boolean;
  parts: (probe: Probe) => Part[];
  /** Grants the walk adds to `permissions.allow`; seed carries them with the pack. */
  grants: string[];
  denies?: string[];
  /** Secret key names the pack's tools read, for a seed recipient to fill in. */
  secretKeys?: string[];
  /** Non-secret keys the walk plants in settings.local.json `env`. */
  settingsEnv?: string[];
}

const mcp = (names: string[]): string[] => names.map((name) => `${MCP_PREFIX}${name}`);
const always = (): boolean => true;
const granted = (probe: Probe, grants: string[]): boolean => grants.every((grant) => probe.allow.has(grant));
const anyGranted = (probe: Probe, grants: string[]): boolean => grants.some((grant) => probe.allow.has(grant));
const hasSecret = (probe: Probe, prefix: string): boolean =>
  [...probe.secrets].some((name) => name === prefix || name.startsWith(`${prefix}_`));

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
export const PACK_SERVERS = ['xcode'];

export const PACKS = {
  browser: {
    label: 'Browser',
    group: PackGroup.Web,
    blurb: 'screenshots, PDFs and page text from any site, scripted flows, optional Perplexity search',
    walk: 'A.2b',
    remove: 'Browser',
    available: always,
    parts: (probe) => [
      { label: 'browser tool permissions', ok: granted(probe, PLAYWRIGHT) },
      {
        label: 'Perplexity search key',
        ok: probe.allow.has(`${MCP_PREFIX}web_search`) && probe.secrets.has('PERPLEXITY_API_KEY'),
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
    remove: 'SEO',
    available: always,
    parts: (probe) => [
      { label: 'SEO tool permissions', ok: anyGranted(probe, SEO) },
      { label: 'site URL (GSC_SITE_URL)', ok: (probe.env.GSC_SITE_URL ?? '').trim() !== '', optional: true },
      { label: 'Google sign-in', ok: probe.secrets.has('google/tokens'), optional: true },
      { label: 'SerpAPI key', ok: probe.secrets.has('SERPAPI_KEY'), optional: true },
      { label: 'Open PageRank key', ok: probe.secrets.has('OPENPAGERANK_API_KEY'), optional: true }
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
    remove: 'Notes',
    available: always,
    parts: (probe) => [
      { label: 'approved public facts (knowledge/public.md)', ok: probe.exists('knowledge/public.md') },
      { label: 'scouting turned on (AGENT_NOTES_SCOUT)', ok: probe.env.AGENT_NOTES_SCOUT === 'true' }
    ],
    grants: []
  },
  github: {
    label: 'GitHub',
    group: PackGroup.Code,
    blurb: 'PRs, issues and CI runs: reviews, replies, walkthroughs, and keeping your checkouts current',
    walk: 'A.2d',
    remove: 'GitHub',
    available: always,
    parts: (probe) => [
      { label: 'GitHub tool permissions', ok: granted(probe, GITHUB) },
      { label: 'gh kept out of the shell', ok: probe.deny.has('Bash(gh *)') },
      { label: 'a GitHub token', ok: hasSecret(probe, 'GITHUB_TOKEN') }
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
    remove: 'Database',
    available: always,
    parts: (probe) => [
      { label: 'database tool permissions', ok: granted(probe, DATABASE) },
      { label: 'a connection (AGENT_DB_<NAME>)', ok: [...probe.secrets].some((name) => name.startsWith('AGENT_DB_')) }
    ],
    grants: DATABASE
  },
  api: {
    label: 'API',
    group: PackGroup.Code,
    blurb: 'API requests drafted as Bruno, Postman or curl collections you send yourself',
    walk: 'A.2e',
    remove: null,
    available: always,
    parts: (probe) => [
      {
        label: 'a collection folder (reports/api/)',
        ok: ['bruno', 'postman', 'curl'].some((adapter) => probe.exists(`reports/api/${adapter}`))
      }
    ],
    grants: []
  },
  xcode: {
    label: 'Xcode',
    group: PackGroup.Code,
    blurb: "build, test, run and debug Apple apps through Xcode's own MCP server",
    walk: 'A.2f',
    remove: 'Xcode',
    available: (probe) => probe.macos,
    parts: (probe) => [
      { label: 'the xcode server in .mcp.json', ok: probe.mcpServers.includes('xcode') },
      { label: 'Xcode tool permissions', ok: probe.allow.has('mcp__xcode__*') },
      { label: 'the Xcode rules (.claude/rules/xcode.md)', ok: probe.exists('.claude/rules/xcode.md') }
    ],
    grants: ['mcp__xcode__*']
  },
  helpdesk: {
    label: 'Helpdesk',
    group: PackGroup.Support,
    blurb: 'read SupportCandy or Pylon tickets and leave private draft notes; a person sends every reply',
    walk: 'A.2g',
    remove: 'Helpdesk',
    available: always,
    parts: (probe) => [
      { label: 'helpdesk tool permissions', ok: granted(probe, HELPDESK_READ) },
      {
        label: 'a helpdesk login',
        ok: hasSecret(probe, 'SUPPORTCANDY_APP_PASSWORD') || hasSecret(probe, 'PYLON_API_TOKEN')
      },
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
    remove: 'App Store',
    available: always,
    parts: (probe) => [{ label: 'the reviews tool permission', ok: granted(probe, mcp(['appstore_reviews'])) }],
    grants: mcp(['appstore_reviews'])
  },
  slack: {
    label: 'Slack',
    group: PackGroup.Support,
    blurb: 'read-only Slack through your account: pulses, replies you owe, threads waiting on you',
    walk: 'A.2i',
    remove: 'Slack',
    available: always,
    parts: (probe) => [
      { label: 'Slack tool permissions', ok: granted(probe, SLACK) },
      { label: 'a Slack app (AGENT_SLACK_CLIENT_ID)', ok: (probe.env.AGENT_SLACK_CLIENT_ID ?? '') !== '' },
      { label: 'signed in to Slack', ok: probe.secrets.has('slack/tokens') }
    ],
    grants: SLACK,
    settingsEnv: ['AGENT_SLACK_CLIENT_ID']
  },
  cmux: {
    label: 'cmux',
    group: PackGroup.Workspace,
    blurb: "the AgentLayer sidebar in cmux: every session by what needs you, each agent's tasks and pages",
    walk: 'A.2j',
    remove: 'cmux',
    available: (probe) => probe.macos && probe.cmuxApp,
    parts: (probe) => [{ label: 'this home in the cmux sidebar', ok: probe.cmux === 'joined' }],
    grants: []
  },
  finances: {
    label: 'Finances',
    group: PackGroup.Workspace,
    blurb: 'tax deadlines and books for your companies and you, statements, spending by category',
    walk: 'A.2l',
    remove: null,
    available: always,
    parts: (probe) => [
      { label: 'a profile per company and for you (projects/finances/entities/)', ok: probe.finances.length > 0 },
      ...probe.finances
        .filter((entity) => entity.company)
        .map((entity) => ({ label: `${entity.slug}'s bank accounts`, ok: entity.accounts })),
      { label: 'categorising rules (RULES.md)', ok: probe.exists('projects/finances/RULES.md'), optional: true }
    ],
    grants: []
  },
  libraries: {
    label: 'Third-party libraries',
    group: PackGroup.Extend,
    blurb: 'skill libraries others publish (SEO/GEO, marketing playbooks), linked into .claude/skills/',
    walk: 'F',
    remove: 'F.4',
    available: always,
    parts: (probe) => [{ label: 'a library linked', ok: probe.libraries > 0 }],
    grants: []
  },
  mcp: {
    label: 'Remote MCP servers',
    group: PackGroup.Extend,
    blurb: "another service's MCP server, behind a hardened wrapper in .mcp.json",
    walk: 'B',
    remove: null,
    available: always,
    parts: (probe) => [
      {
        label: 'a server in .mcp.json',
        ok: probe.mcpServers.some((name) => !PACK_SERVERS.includes(name))
      }
    ],
    grants: []
  }
} satisfies Record<string, PackDef>;

export type PackId = keyof typeof PACKS;

export const PackState = { New: 'new', Partial: 'partial', Ready: 'ready' } as const;
export type PackState = (typeof PackState)[keyof typeof PackState];

export interface PackStatus {
  id: PackId;
  label: string;
  group: PackGroup;
  blurb: string;
  walk: string;
  remove: string | null;
  available: boolean;
  state: PackState;
  /** What a set-up pack still lacks, an optional part marked so. */
  missing: string[];
}

/** A pack is new when it has none of its parts, set up when it has every required one, and half-done between. */
export const statusOf = (id: PackId, probe: Probe): PackStatus => {
  const def: PackDef = PACKS[id];
  const parts = def.parts(probe);
  const required = parts.filter((part) => part.optional !== true);
  const state = !parts.some((part) => part.ok)
    ? PackState.New
    : required.every((part) => part.ok)
      ? PackState.Ready
      : PackState.Partial;
  return {
    id,
    label: def.label,
    group: def.group,
    blurb: def.blurb,
    walk: def.walk,
    remove: def.remove,
    available: def.available(probe),
    state,
    missing:
      state === PackState.New
        ? []
        : parts
            .filter((part) => !part.ok)
            .map((part) => (part.optional === true ? `${part.label} (optional)` : part.label))
  };
};

export const packIds = (): PackId[] => Object.keys(PACKS).filter((id): id is PackId => id in PACKS);
