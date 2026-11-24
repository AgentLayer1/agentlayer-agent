/**
 * What a host's per-home wiring reads from a home, shared by each host's setup script: the plugin's manifest, the
 * home's Claude settings (the posture's source of truth), the user-level Claude denies, the stdio MCP servers the home
 * registers, and the one quoting a hook command line takes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { PLUGIN_SOURCE_ROOT } from '../../../src/shared/naming';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const readJson = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return isRecord(parsed) ? parsed : {};
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const expandTilde = (path: string): string => path.replace(/^~(?=$|\/)/, homedir());

export interface PluginManifest {
  /** The host's name for the agent: its tables and entries share one namespace with the operator's own. */
  pluginName: string;
  /** The server key Claude Code namespaces under the plugin, needed to read Claude's MCP rules. */
  claudeServer: string;
}

/** The agent's names, from the manifest of the checkout being wired, else this one. */
export const readManifest = (pluginRoot: string): PluginManifest => {
  const manifestPath = [pluginRoot, PLUGIN_SOURCE_ROOT]
    .map((root) => resolve(root, '.claude-plugin', 'plugin.json'))
    .find((path) => existsSync(path));
  const manifest = readJson(String(manifestPath));
  const pluginName = String(manifest.name ?? '');
  const claudeServer = Object.keys(isRecord(manifest.mcpServers) ? manifest.mcpServers : {})[0] ?? '';
  if (!pluginName || !claudeServer) {
    throw new Error(`${manifestPath}: the plugin manifest names no plugin or no MCP server`);
  }
  return { pluginName, claudeServer };
};

export interface ClaudeSettings {
  env?: Record<string, unknown>;
  permissions?: { ask?: unknown; deny?: unknown; additionalDirectories?: unknown };
  enabledMcpjsonServers?: unknown;
  disabledMcpjsonServers?: unknown;
  enableAllProjectMcpServers?: unknown;
}

const stringsOf = (list: unknown): string[] =>
  Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];

export interface HomeSettings {
  /** The string values of the settings' `env` blocks, the local file's winning. */
  env: Record<string, string>;
  /** An `AGENT_<key>` value from the settings' `env`. */
  settingValue: (key: string) => string | undefined;
  settingList: (key: keyof NonNullable<ClaudeSettings['permissions']>) => string[];
  serverList: (key: 'enabledMcpjsonServers' | 'disabledMcpjsonServers') => string[];
  approvesAll: boolean;
}

/** The home's `.claude/settings.json` and `settings.local.json`, read together. */
export const readHomeSettings = (homeDir: string): HomeSettings => {
  const claudeSettings = ['settings.json', 'settings.local.json'].map(
    (file) => readJson(resolve(homeDir, '.claude', file)) as ClaudeSettings
  );
  const settingsEnv: Record<string, string> = Object.fromEntries(
    claudeSettings.flatMap((settings) =>
      Object.entries(settings.env ?? {}).filter((pair): pair is [string, string] => typeof pair[1] === 'string')
    )
  );
  return {
    env: settingsEnv,
    settingValue: (key) => settingsEnv[`AGENT_${key}`],
    settingList: (key) => claudeSettings.flatMap((settings) => stringsOf(settings.permissions?.[key])),
    serverList: (key) => claudeSettings.flatMap((settings) => stringsOf(settings[key])),
    approvesAll: claudeSettings.some((settings) => settings.enableAllProjectMcpServers === true)
  };
};

/** The `permissions.deny` list of the user-level Claude settings, which apply to every project. */
export const readUserDenies = (claudeUserSettingsPath: string): string[] =>
  stringsOf((readJson(claudeUserSettingsPath) as ClaudeSettings).permissions?.deny);

/** Directories the agent works in outside the home, in the order the settings name them. */
export const workspaceRootsOf = (homeDir: string, settings: HomeSettings): string[] => {
  const insideHome = (path: string): boolean => {
    const fromHome = relative(homeDir, path);
    return fromHome === '' || (!fromHome.startsWith('..') && !isAbsolute(fromHome));
  };
  return [
    ...new Set(
      [
        settings.settingValue('CODE_PATH') ?? '',
        ...(settings.settingValue('GIT_REPOS') ?? '').split(','),
        ...settings.settingList('additionalDirectories'),
        ...['KNOWLEDGE', 'PROJECTS', 'REPORTS'].map((key) => settings.settingValue(key) ?? '')
      ]
        .map((path) => path.trim())
        .filter(Boolean)
        .map((path) => resolve(homeDir, expandTilde(path)))
    )
  ].filter((path) => !insideHome(path));
};

/** Claude `Read(…)` denies as deny globs: `//x` is filesystem-absolute, `~/x` the user's home, anything else a workspace-relative pattern. */
export const denyGlobs = (patterns: string[]): string[] => [
  ...new Set(
    patterns
      .map((pattern) => /^Read\((.+)\)$/.exec(pattern)?.[1] ?? '')
      .filter(Boolean)
      .map((glob) => (glob.startsWith('//') ? glob.slice(1) : glob.startsWith('~/') ? expandTilde(glob) : glob))
  )
];

/** Shell patterns as rule prefixes: `Bash(git push *)` → `git push`. MCP tool rules and mid-pattern globs have no prefix form. */
export const shellPrefixes = (patterns: string[]): string[] => [
  ...new Set(
    patterns
      .map((pattern) => /^Bash\((.+)\)$/.exec(pattern)?.[1] ?? '')
      .map((body) => body.replace(/\s*:?\*$/, '').trim())
      .filter((body) => body && !/[*?[\]{}]/.test(body))
  )
];

/** The MCP servers the plugin's packs register in `<home>/.mcp.json`; a host gets a copy of each, owned like the agent's own. */
export const PACK_SERVERS = ['xcode'];

export interface McpRegistration {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface HomeServers {
  /** Every stdio server the home registers, approved or not, so a server Claude stops running loses its copy too. */
  owned: string[];
  /** Claude fills `${VAR}` into `.mcp.json` entries; a host that passes the text through gets no copy of these. */
  interpolating: string[];
  /** The servers to copy: the packs' own, and each one Claude has approved, so both hosts run the same set. */
  mirrored: Record<string, McpRegistration>;
}

export const readHomeServers = (homeDir: string, settings: HomeSettings, pluginName: string): HomeServers => {
  const registered = readJson(resolve(homeDir, '.mcp.json')).mcpServers;
  const registrations = isRecord(registered) ? registered : {};
  const isStdio = (server: unknown): server is Record<string, unknown> & { command: string } =>
    isRecord(server) && typeof server.command === 'string';
  const approvedByClaude = (name: string): boolean =>
    (settings.approvesAll || settings.serverList('enabledMcpjsonServers').includes(name)) &&
    !settings.serverList('disabledMcpjsonServers').includes(name);
  const owned = [
    ...new Set([
      ...PACK_SERVERS,
      ...Object.keys(registrations).filter(
        (name) => /^[A-Za-z0-9_-]+$/.test(name) && name !== pluginName && isStdio(registrations[name])
      )
    ])
  ];
  const interpolating = owned.filter((name) => JSON.stringify(registrations[name] ?? {}).includes('${'));
  const mirrored = Object.fromEntries(
    owned.flatMap((name): [string, McpRegistration][] => {
      const server = registrations[name];
      if (
        !isStdio(server) ||
        interpolating.includes(name) ||
        !(PACK_SERVERS.includes(name) || approvedByClaude(name))
      ) {
        return [];
      }
      const env = Object.fromEntries(
        Object.entries(isRecord(server.env) ? server.env : {}).filter(
          (pair): pair is [string, string] => typeof pair[1] === 'string'
        )
      );
      return [[name, { command: server.command, args: stringsOf(server.args), env }]];
    })
  );
  return { owned, interpolating, mirrored };
};

/** Double quotes are the one quoting sh and PowerShell agree on; a path either shell would expand inside them is refused. */
export const quote = (value: string): string => {
  if (/["$`]/.test(value)) {
    throw new Error(`${value}: a path in a hook command may not contain ", $, or a backtick`);
  }
  return `"${value}"`;
};
