#!/usr/bin/env bun
/**
 * The per-home Codex wiring: hooks in `<home>/.codex/hooks.json` (the SessionStart
 * context with Codex's per-hook output cap lifted, the SessionEnd capture, the
 * PreCompact capture that saves a long session before Codex compacts it, and the
 * PreToolUse guard against home trees written relative to a drifted cwd), the agent's MCP
 * server plus its permission posture in `<home>/.codex/config.toml`, and the command rules
 * in `<home>/.codex/rules/<plugin>.rules`, every command pointing at this plugin checkout
 * and this home. Codex has no `@-import`, and a plugin cannot bundle hooks or an MCP
 * server that knows which home it serves (the server is launched inside the plugin
 * cache, with no workspace variable and no MCP roots), so init and upgrade write these
 * files. The posture is read from the home's Claude settings so the two hosts never
 * drift: the runtime secrets store is denied, the code path and additional directories
 * become workspace roots with `.git` writable, and every `permissions.ask` shell pattern
 * becomes a rule that prompts, as does every MCP tool it names, through that tool's `approval_mode`. An MCP server a pack registered in the home's `.mcp.json`
 * (the Xcode pack's `xcode`), or one Claude has approved there, is mirrored into its own
 * `[mcp_servers.<name>]` table, owned the same way, so a server set up before Codex was
 * wired still reaches it and a deconfigured pack's leaves. The config also carries the
 * footer status line a Codex session shows from the home (model, directory, branch,
 * approval mode, context used), set when absent. Only the agent's own entries and tables
 * are replaced: the operator's other hooks, MCP servers, rules files, and settings
 * survive; a file that does not parse, or one whose other settings would not survive the
 * rewrite in meaning, is left alone. The hook commands carry the home as a `--home=`
 * argument rather than an env prefix, double-quoted, so the same line parses under sh
 * and under the PowerShell Codex uses on Windows.
 *
 * Usage: codex-setup.ts --home <dir> [--plugin-root <dir>] [--write] [--claude-user-settings <file>] [--codex-user-config <file>]
 *   Prints the merged hooks document. With --write it writes the files whose content
 *   differs and prints `{ hooks, mcp, rules, entries, profile, notes }`, each file as
 *   `{ path, changed }`, so the caller knows a hook re-trust is due.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { readMergedSettings } from '../../../src/home/settings-scope';
import { workRootsOf } from '../../../src/home/work-roots';
import { CLI_FILE, PLUGIN_SOURCE_ROOT, RUNTIME_DIR } from '../../../src/shared/naming';
import { readTextIfExists } from '../../../src/shared/text';
import { CODEX_EFFORT, CODEX_MODEL } from './codex-model';
import {
  denyGlobs,
  expandTilde,
  isRecord,
  quote,
  readHomeServers,
  readHomeSettings,
  readManifest,
  readUserDenies,
  shellPrefixes,
} from './wiring';

interface HookItem {
  type: string;
  command?: string;
  timeout?: number;
  /** Codex truncates a hook's context at ~2,500 tokens unless this is raised; 0 lifts the cap. */
  additionalContextLimit?: number;
}
interface HookGroup {
  matcher?: string;
  hooks: HookItem[];
}
interface HooksDocument {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}
type TomlDocument = Record<string, unknown>;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const home = flag('home');
if (!home) {
  process.stderr.write('usage: codex-setup.ts --home <dir> [--plugin-root <dir>] [--write]\n');
  process.exit(2);
}
const homeDir = resolve(home);
const pluginRoot = resolve(flag('plugin-root') ?? PLUGIN_SOURCE_ROOT);
const claudeUserSettingsPath = flag('claude-user-settings') ?? resolve(homedir(), '.claude', 'settings.json');
const userConfigPath = flag('codex-user-config') ?? resolve(homedir(), '.codex', 'config.toml');
const hooksPath = resolve(homeDir, '.codex', 'hooks.json');
const configPath = resolve(homeDir, '.codex', 'config.toml');

const { pluginName, claudeServer } = readManifest(pluginRoot);
const rulesPath = resolve(homeDir, '.codex', 'rules', `${pluginName}.rules`);

// ── The home's Claude settings: the posture's source of truth ─────────────────
const settings = readHomeSettings(homeDir);
const { settingList, env: settingsEnv } = settings;
const workspaceRoots = workRootsOf(homeDir, readMergedSettings(homeDir).merged);
const readDenies = denyGlobs(settingList('deny'));
const askPrefixes = shellPrefixes(settingList('ask'));
const denyPrefixes = shellPrefixes(settingList('deny'));

// ── MCP servers: what the home registered in .mcp.json ─────────────────────────
const {
  owned: OWNED_SERVERS,
  interpolating: interpolatingServers,
  mirrored: mirroredServers
} = readHomeServers(homeDir, settings, pluginName);

// ── Hooks ────────────────────────────────────────────────────────────────────
/** A hook command of ours, whichever checkout (quoted or not) it points at. */
const AGENT_COMMAND = /src[\\/]cli\.ts["']? (session-(start|capture)|guard) .*--hook-protocol=codex/;
const command = (rest: string): string =>
  `bun ${quote(resolve(pluginRoot, CLI_FILE))} ${rest} --home=${quote(homeDir)}`;
const entry = (commandLine: string, timeout: number, extra: Partial<HookItem> = {}, matcher = ''): HookGroup => ({
  matcher,
  hooks: [{ type: 'command', command: commandLine, timeout, ...extra }]
});
const isAgentEntry = (item: HookItem): boolean => typeof item.command === 'string' && AGENT_COMMAND.test(item.command);
const withoutAgentEntries = (groups: HookGroup[] = []): HookGroup[] =>
  groups
    .map((group) => ({ ...group, hooks: group.hooks.filter((item) => !isAgentEntry(item)) }))
    .filter((group) => group.hooks.length > 0);

const readHooks = (): HooksDocument => {
  if (!existsSync(hooksPath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(hooksPath, 'utf-8'));
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new Error(`${hooksPath} is not a JSON object`);
  }
  const document = parsed as HooksDocument;
  for (const [event, groups] of Object.entries(document.hooks ?? {})) {
    if (!Array.isArray(groups) || groups.some((group) => !Array.isArray(group?.hooks))) {
      throw new Error(`${hooksPath}: hooks.${event} is not a list of hook groups`);
    }
  }
  return document;
};
const existingHooks = readHooks();
const hooksDocument: HooksDocument = {
  ...existingHooks,
  hooks: {
    ...existingHooks.hooks,
    SessionStart: [
      ...withoutAgentEntries(existingHooks.hooks?.SessionStart),
      entry(command('session-start --hook-protocol=codex'), 15, { additionalContextLimit: 0 })
    ],
    SessionEnd: [
      ...withoutAgentEntries(existingHooks.hooks?.SessionEnd),
      // Codex clamps a SessionEnd hook to 3 seconds whatever the entry says.
      entry(command('session-capture --mode=session-end --hook-protocol=codex'), 3)
    ],
    PreCompact: [
      ...withoutAgentEntries(existingHooks.hooks?.PreCompact),
      entry(command('session-capture --mode=pre-compact --hook-protocol=codex'), 30)
    ],
    // Codex presents shell commands, unified exec included, to hooks as tool name Bash, the Claude Code shape.
    PreToolUse: [
      ...withoutAgentEntries(existingHooks.hooks?.PreToolUse),
      entry(command('guard --hook-protocol=codex'), 5, {}, 'Bash')
    ]
  }
};
const hooksText = `${JSON.stringify(hooksDocument, null, 2)}\n`;

// ── config.toml ──────────────────────────────────────────────────────────────
const parseToml = (text: string, label: string): TomlDocument => {
  try {
    return Bun.TOML.parse(text) as TomlDocument;
  } catch (err) {
    throw new Error(`${label} is not valid TOML: ${err instanceof Error ? err.message : String(err)}`);
  }
};
const lookup = (document: TomlDocument, path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), document);

/** The key path of a `[table]` / `[[array]]` header line, bare or quoted segments alike; undefined for other lines. */
const headerPath = (line: string): string[] | undefined => {
  const match = /^\s*\[\[?\s*(.+?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
  return match ? [...match[1].matchAll(/"([^"]*)"|'([^']*)'|([^.\s]+)/g)].map((m) => m[1] ?? m[2] ?? m[3]) : undefined;
};
/** The tables this script owns outright; everything under them is regenerated. */
const OWNED_TABLES: string[][] = [
  ['mcp_servers', pluginName],
  ...OWNED_SERVERS.map((name) => ['mcp_servers', name]),
  ['permissions', pluginName],
  ['shell_environment_policy']
];
/** The top-level keys it sets when absent; an operator's own value is kept. */
const OWNED_KEYS: Record<string, string | number> = {
  default_permissions: pluginName,
  approval_policy: 'on-request',
  approvals_reviewer: 'user',
  model: CODEX_MODEL,
  model_reasoning_effort: CODEX_EFFORT,
  // Codex reads 32,768 bytes of AGENTS.md by default and drops the rest with only a log warning.
  project_doc_max_bytes: 65_536
};
interface OwnedTableKeys {
  label: string;
  keys: Record<string, string[] | boolean | number>;
}
/** Keys set inside a named table when absent; an operator's own value is kept. */
const OWNED_TABLE_KEYS: Record<string, OwnedTableKeys> = {
  tui: {
    label: 'the status line',
    keys: {
      status_line: ['model-with-reasoning', 'current-dir', 'git-branch', 'approval-mode', 'context-used'],
      status_line_use_colors: true
    }
  },
  // Codex renders every skill's description each turn under a budget of 2% of the model window
  // (5,440 tokens on 272K) and trims them to fit; 10,000 is the most an explicit value may claim.
  skills: { label: 'the skills context budget', keys: { max_context_tokens: 10_000 } },
  // Codex's docs list the keys a project config can't set (otel, notify, providers); these two aren't
  // among them, so the home turns them off for its own sessions whatever the user's config says.
  analytics: { label: 'usage analytics', keys: { enabled: false } },
  feedback: { label: 'feedback uploads', keys: { enabled: false } }
};
const isTable = (value: unknown): boolean =>
  Array.isArray(value) ? value.every(isTable) : typeof value === 'object' && value !== null;
const isOwnedHeader = (path: string[]): boolean =>
  OWNED_TABLES.some((owned) => owned.every((segment, index) => path[index] === segment));
/** Drop the owned tables with the blank lines that separated them, leaving every other line untouched. */
const withoutOwnedTables = (text: string): string => {
  const kept: string[] = [];
  let dropping = false;
  for (const line of text.split('\n')) {
    const path = headerPath(line);
    if (path) {
      const wasDropping = dropping;
      dropping = isOwnedHeader(path);
      if (dropping) {
        while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
      } else if (wasDropping && kept.length > 0 && kept[kept.length - 1].trim() !== '') {
        kept.push('');
      }
    }
    if (!dropping) kept.push(line);
  }
  return kept.join('\n');
};

const tomlString = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const tomlScalar = (key: string, value: unknown): string => {
  const name = /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
  if (typeof value === 'string') return `${name} = ${tomlString(value)}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `${name} = ${String(value)}`;
  if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) {
    return `${name} = [${value.map(tomlString).join(', ')}]`;
  }
  throw new Error(
    `${configPath}: ${key} carries a value this script cannot rewrite; move it out of the agent's tables and rerun`
  );
};
// What Claude denies for every project at user level, minus what the operator's user-level Codex
// profile already denies: the rest lands in this home's profile, so a home is covered either way
// and the user-level file stays the operator's own.
const userTables = existsSync(userConfigPath) ? parseToml(readFileSync(userConfigPath, 'utf-8'), userConfigPath) : {};
const userProfile = lookup(userTables, ['permissions', String(userTables.default_permissions ?? '')]) as
  | Record<string, unknown>
  | undefined;
const userFilesystem = (userProfile?.filesystem as Record<string, unknown> | undefined) ?? {};
const userDenied = new Set(
  [
    ...Object.entries(userFilesystem),
    ...Object.entries((userFilesystem[':workspace_roots'] as Record<string, unknown> | undefined) ?? {})
  ]
    .filter(([, access]) => access === 'deny')
    .map(([glob]) => expandTilde(glob))
);
const inheritedDenies = denyGlobs(readUserDenies(claudeUserSettingsPath)).filter((glob) => !userDenied.has(glob));
const absoluteDenies = [...new Set([...readDenies, ...inheritedDenies])].filter((glob) => glob.startsWith('/'));
const relativeDenies = [...new Set([...readDenies, ...inheritedDenies])].filter((glob) => !glob.startsWith('/'));
const existingConfig = readTextIfExists(configPath);
const existingTables = parseToml(existingConfig, configPath);
const legacySandboxKeys = ['sandbox_mode', 'sandbox_workspace_write'].filter((key) => key in existingTables);
if (legacySandboxKeys.length > 0) {
  throw new Error(
    `${configPath} sets ${legacySandboxKeys.join(' and ')}, which Codex does not combine with a permission profile; remove them (the profile carries the sandbox) and rerun`
  );
}
/** Whatever the operator added to the agent's own tables (a startup timeout, an extra env var) survives regeneration. */
const keptEntries = (path: string[], own: string[]): string[] =>
  Object.entries((lookup(existingTables, path) as Record<string, unknown> | undefined) ?? {})
    .filter(([key]) => !own.includes(key))
    .map(([key, value]) => tomlScalar(key, value));

/**
 * A server's per-tool tables: the operator's own kept (Codex writes `approve` there for "Always allow"),
 * and every tool `permissions.ask` names set to prompt, since Claude Code's ask beats its allow too.
 */
const toolTables = (server: string, rulePrefix: string): string[] => {
  const asked = settingList('ask')
    .filter((rule) => rule.startsWith(rulePrefix))
    .map((rule) => rule.slice(rulePrefix.length))
    .filter((tool) => /^[A-Za-z0-9_-]+$/.test(tool));
  const existing = lookup(existingTables, ['mcp_servers', server, 'tools']);
  const own = isRecord(existing) ? existing : {};
  return [...new Set([...Object.keys(own), ...asked])].flatMap((tool) => {
    const kept = isRecord(own[tool]) ? own[tool] : {};
    const entries = asked.includes(tool) ? { ...kept, approval_mode: 'prompt' } : kept;
    return [
      `[mcp_servers.${server}.tools.${/^[A-Za-z0-9_-]+$/.test(tool) ? tool : tomlString(tool)}]`,
      ...Object.entries(entries).map(([key, value]) => tomlScalar(key, value)),
      ''
    ];
  });
};

/** The agent's own env for the model's shell: `AGENT_HOME` plus the home's `AGENT_*` settings, never a credential. */
const shellEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(settingsEnv).filter(
      ([key]) => key.startsWith('AGENT_') && !/KEY|SECRET|TOKEN|PASSWORD|CRED|PRIVATE|DSN|^AGENT_DB_/i.test(key)
    )
  ),
  AGENT_HOME: homeDir
};
const existingSet =
  (lookup(existingTables, ['shell_environment_policy', 'set']) as Record<string, unknown> | undefined) ?? {};
const mergedSet: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(existingSet).filter(
      (pair): pair is [string, string] =>
        typeof pair[1] === 'string' && !pair[0].startsWith('AGENT_')
    )
  ),
  ...shellEnv
};
const inlineTable = (entries: Record<string, string>): string =>
  `{ ${Object.entries(entries)
    .map(([key, value]) => `${/^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key)} = ${tomlString(value)}`)
    .join(', ')} }`;

/** A mirrored server as Codex registers it; the operator's own keys in its table (a startup timeout, an env var) survive. */
const serverTables = Object.entries(mirroredServers).flatMap(([name, server]) => {
  const envLines = [
    ...Object.entries(server.env).map(([key, value]) => tomlScalar(key, value)),
    ...keptEntries(['mcp_servers', name, 'env'], Object.keys(server.env))
  ];
  return [
    `[mcp_servers.${name}]`,
    `command = ${tomlString(server.command)}`,
    `args = [${server.args.map(tomlString).join(', ')}]`,
    ...keptEntries(['mcp_servers', name], ['command', 'args', 'env', 'tools']),
    ...(envLines.length > 0 ? ['', `[mcp_servers.${name}.env]`, ...envLines] : []),
    '',
    ...toolTables(name, `mcp__${name}__`)
  ];
});

const agentTables = [
  `[mcp_servers.${pluginName}]`,
  'command = "bun"',
  `args = [${tomlString(resolve(pluginRoot, 'src', 'server.ts'))}]`,
  ...keptEntries(['mcp_servers', pluginName], ['command', 'args', 'env', 'tools']),
  '',
  `[mcp_servers.${pluginName}.env]`,
  `AGENT_HOME = ${tomlString(homeDir)}`,
  'PLAYWRIGHT_BROWSERS_PATH = "0"',
  ...keptEntries(['mcp_servers', pluginName, 'env'], ['AGENT_HOME', 'PLAYWRIGHT_BROWSERS_PATH']),
  '',
  ...toolTables(pluginName, `mcp__plugin_${pluginName}_${claudeServer}__`),
  ...serverTables,
  // The posture: write the home and its repos, commit in them, reach the network, never read the
  // secrets store. An approved escalation does not lift a profile (verified on 0.153), so every
  // writable root and the network have to be granted here or they are unreachable.
  `[permissions.${pluginName}]`,
  `description = ${tomlString(`${pluginName} home: write the home and its repos, commit in them, never read the secrets store`)}`,
  'extends = ":workspace"',
  '',
  `[permissions.${pluginName}.filesystem]`,
  `${tomlString(resolve(homeDir, RUNTIME_DIR, 'secrets'))} = "deny"`,
  ...absoluteDenies.map((glob) => `${tomlString(glob)} = "deny"`),
  '',
  `[permissions.${pluginName}.filesystem.":workspace_roots"]`,
  '".git" = "write"',
  `"**/${RUNTIME_DIR}/secrets/**" = "deny"`,
  ...[...new Set(['**/*.env', '**/.env.*', ...relativeDenies])].map((glob) => `${tomlString(glob)} = "deny"`),
  '',
  `[permissions.${pluginName}.network]`,
  'enabled = true',
  ...(workspaceRoots.length > 0
    ? ['', `[permissions.${pluginName}.workspace_roots]`, ...workspaceRoots.map((root) => `${tomlString(root)} = true`)]
    : []),
  '',
  '[shell_environment_policy]',
  ...keptEntries(['shell_environment_policy'], ['set']),
  `set = ${inlineTable(mergedSet)}`,
  ''
].join('\n');

const otherConfig = withoutOwnedTables(existingConfig).trim();
for (const owned of OWNED_TABLES) {
  if (lookup(parseToml(otherConfig, configPath), owned) !== undefined) {
    throw new Error(
      `${configPath} defines ${owned.join('.')} in a form this script does not rewrite (inline table or dotted keys); remove it by hand and rerun`
    );
  }
}
const missingKeys = Object.entries(OWNED_KEYS).filter(([key]) => !(key in existingTables));
// Top-level keys must precede the first table, or TOML files them under whatever table came last.
const topKeys = missingKeys.map(([key, value]) => tomlScalar(key, value)).join('\n');
// Missing keys go inside an existing `[table]` header, since TOML refuses a second one. A table
// that only holds sub-tables (`[tui.keymap]`, `[[skills.config]]`) gets its own header appended,
// which TOML allows after the sub-tables; one written another way (inline table, dotted keys) is
// left as it is.
const otherLines = otherConfig.split('\n');
const tableFills = Object.entries(OWNED_TABLE_KEYS).map(([table, { label, keys }]) => {
  const existing = (existingTables[table] as Record<string, unknown> | undefined) ?? {};
  const missing = Object.entries(keys)
    .filter(([key]) => !(key in existing))
    .map(([key, value]) => tomlScalar(key, value));
  const headerAt = otherLines.findIndex((line) => headerPath(line)?.join('.') === table);
  const inline =
    headerAt === -1 && table in existingTables && !otherLines.some((line) => headerPath(line)?.[0] === table);
  return { table, label, hint: `${table}.${Object.keys(keys)[0]}`, missing, headerAt, inline };
});
const operatorConfig = tableFills
  .filter(({ headerAt }) => headerAt !== -1)
  .toSorted((a, b) => b.headerAt - a.headerAt)
  .reduce((lines, { headerAt, missing }) => lines.toSpliced(headerAt + 1, 0, ...missing), otherLines)
  .join('\n');
const newTables = tableFills
  .filter(({ missing, headerAt, inline }) => missing.length > 0 && headerAt === -1 && !inline)
  .map(({ table, missing }) => [`[${table}]`, ...missing].join('\n'));
const configText = [topKeys, operatorConfig, ...newTables, agentTables].filter(Boolean).join('\n\n');
const generatedTables = parseToml(configText, 'the generated config');
if (lookup(generatedTables, ['mcp_servers', pluginName, 'env', 'AGENT_HOME']) !== homeDir) {
  throw new Error(`the generated ${configPath} does not register this home; nothing written`);
}
/** Everything this script does not own, for the equality check. */
const withoutOwn = (document: TomlDocument): TomlDocument => {
  const rest: TomlDocument = { ...document };
  for (const key of Object.keys(OWNED_KEYS)) delete rest[key];
  for (const [table, { keys }] of Object.entries(OWNED_TABLE_KEYS)) {
    const inner = { ...((rest[table] as TomlDocument | undefined) ?? {}) };
    for (const key of Object.keys(keys)) delete inner[key];
    if (Object.keys(inner).length > 0) rest[table] = inner;
    else delete rest[table];
  }
  for (const [table, name] of OWNED_TABLES) {
    if (name === undefined) {
      delete rest[table];
      continue;
    }
    const inner = { ...((rest[table] as TomlDocument | undefined) ?? {}) };
    delete inner[name];
    if (Object.keys(inner).length > 0) rest[table] = inner;
    else delete rest[table];
  }
  return rest;
};
if (JSON.stringify(withoutOwn(existingTables)) !== JSON.stringify(withoutOwn(generatedTables))) {
  throw new Error(`${configPath}: rewriting it would change a setting outside the agent's own tables; nothing written`);
}
const userSandboxKeys = ['sandbox_mode', 'sandbox_workspace_write', 'default_permissions'].filter(
  (key) => key in userTables
);
const notes = [
  ...(userSandboxKeys.length > 0
    ? [
        `${userConfigPath} sets ${userSandboxKeys.join(' and ')}; this home's profile overrides it for sessions started here, and Codex does not combine sandbox_mode with a profile`
      ]
    : []),
  ...tableFills
    .filter(({ missing, inline }) => missing.length > 0 && inline)
    .map(
      ({ table, label, hint }) =>
        `${configPath} defines ${table} without a [${table}] header, so ${label} was not added; set ${hint} there yourself`
    ),
  ...Object.entries(OWNED_KEYS)
    .filter(([key, value]) => key in existingTables && existingTables[key] !== value)
    .map(
      ([key, value]) =>
        `${key} is ${JSON.stringify(existingTables[key])} in ${configPath}; the recommended value is "${value}" and yours was kept`
    ),
  ...OWNED_SERVERS.filter(
    (name) => !(name in mirroredServers) && lookup(existingTables, ['mcp_servers', name]) !== undefined
  ).map(
    (name) =>
      `[mcp_servers.${name}] was removed from ${configPath}: the home's .mcp.json no longer registers ${name}, or Claude Code doesn't run it`
  ),
  ...interpolatingServers.map(
    (name) =>
      `${name} was not mirrored into ${configPath}: its .mcp.json entry uses \${VAR}, which Claude Code fills in and Codex does not`
  )
];

// ── rules ────────────────────────────────────────────────────────────────────
const rule = (prefix: string, decision: 'prompt' | 'forbidden'): string =>
  [
    'prefix_rule(',
    `    pattern = [${prefix
      .split(/\s+/)
      .map((word) => JSON.stringify(word))
      .join(', ')}],`,
    `    decision = "${decision}",`,
    `    justification = ${JSON.stringify(
      decision === 'prompt'
        ? `${prefix} waits for the operator, as it does under Claude Code`
        : `${prefix} is denied in this home, as it is under Claude Code`
    )},`,
    ')'
  ].join('\n');
// Codex applies the most restrictive matching rule, so a forbidden prefix wins over a prompt one beneath it.
const rulesText =
  [
    `# Generated by the ${pluginName} plugin from this home's Claude permissions.ask and permissions.deny; regenerated by init and upgrade.`,
    '# Your own rules belong in another file in this directory: Codex loads every .rules file here.',
    ...askPrefixes.map((prefix) => rule(prefix, 'prompt')),
    ...denyPrefixes.map((prefix) => rule(prefix, 'forbidden'))
  ].join('\n\n') + '\n';

// ── write ────────────────────────────────────────────────────────────────────
const writeIfChanged = (path: string, text: string): { path: string; changed: boolean } => {
  const changed = !existsSync(path) || readFileSync(path, 'utf-8') !== text;
  if (changed) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return { path, changed };
};

if (!args.includes('--write')) {
  process.stdout.write(hooksText);
} else {
  // The server first: hooks that outlive a failed config write would point at nothing.
  const mcp = writeIfChanged(configPath, configText);
  const rules = writeIfChanged(rulesPath, rulesText);
  const hooks = writeIfChanged(hooksPath, hooksText);
  const profile = {
    name: pluginName,
    workspaceRoots,
    rules: askPrefixes,
    forbidden: denyPrefixes,
    servers: Object.keys(mirroredServers)
  };
  process.stdout.write(`${JSON.stringify({ hooks, mcp, rules, entries: 4, profile, notes })}\n`);
}
