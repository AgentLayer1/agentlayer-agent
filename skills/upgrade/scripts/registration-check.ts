#!/usr/bin/env bun
/**
 * Preflight for the upgrade skill: is this plugin registered the way the current release
 * expects, on Claude Code and on Codex? Reads the host registries and the home's settings,
 * never writes, and prints each finding with the exact commands that fix it plus the
 * settings keys the skill flips itself.
 *
 * On Antigravity, which loads the checkout named in the user's personal plugins.json, it reports a manifest naming
 * another checkout of this plugin, and an installed copy that would load the plugin a second time.
 *
 * Usage: registration-check.ts --home <dir> [--plugin-root <dir>] [--claude-dir <dir>] [--codex-dir <dir>] [--gemini-dir <dir>]
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { entriesOf, namesCheckout } from '../../../src/hosts/antigravity';
import { codexHost } from '../../../src/hosts/codex';
import type { HostName } from '../../../src/hosts/contract';
import { PLUGIN_SOURCE_ROOT } from '../../../src/shared/naming';
import { listDirs } from '../../../src/shared/text';

/** Where consumers install from, and the marketplace repos that name replaced. */
const PUBLISHED = {
  name: 'agentlayer',
  repo: 'AgentLayer1/agentlayer-agent-marketplace',
  retired: ['AgentLayer1/agentlayer-claude-marketplace']
};

interface Finding {
  host: HostName;
  kind: 'renamed-catalog' | 'retired-marketplace' | 'not-installed' | 'stale-copy' | 'stale-path' | 'global-copy';
  detail: string;
  commands: string[];
}
interface KeyFlip {
  from: string;
  to: string;
}
const warnings: string[] = [];

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const home = flag('home');
if (!home) {
  process.stderr.write(
    'usage: registration-check.ts --home <dir> [--plugin-root <dir>] [--claude-dir <dir>] [--codex-dir <dir>] [--gemini-dir <dir>]\n'
  );
  process.exit(2);
}
const homeDir = resolve(home);
const pluginRoot = resolve(flag('plugin-root') ?? PLUGIN_SOURCE_ROOT);
const claudeDir = resolve(flag('claude-dir') ?? resolve(homedir(), '.claude'));
const codexDir = resolve(flag('codex-dir') ?? resolve(homedir(), '.codex'));
const geminiDir = resolve(flag('gemini-dir') ?? resolve(homedir(), '.gemini'));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
/** A host registry or home file; one that does not parse is reported, not fatal. */
const readJson = (path: string): Record<string, unknown> | undefined => {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch (err) {
    warnings.push(`${path} did not parse: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
};
const catalogName = (dir: string): string | undefined => {
  const claude = readJson(resolve(dir, '.claude-plugin', 'marketplace.json'))?.name;
  const codex = readJson(resolve(dir, '.agents', 'plugins', 'marketplace.json'))?.name;
  return typeof claude === 'string' ? claude : typeof codex === 'string' ? codex : undefined;
};

const manifest = readJson(resolve(pluginRoot, '.claude-plugin', 'plugin.json'));
const plugin = String(manifest?.name ?? '');
const version = String(manifest?.version ?? '');
if (!plugin || !version) {
  throw new Error(`${pluginRoot} has no .claude-plugin/plugin.json naming the plugin and its version`);
}
const devName = catalogName(pluginRoot);
const findings: Finding[] = [];
const settings: { enabledPlugins?: KeyFlip; extraKnownMarketplaces?: KeyFlip } = {};

// Claude Code: the user's marketplace registry, keyed by marketplace name.
interface Registration {
  source?: { source?: string; path?: string; repo?: string };
}
const known = (readJson(resolve(claudeDir, 'plugins', 'known_marketplaces.json')) ?? {}) as Record<
  string,
  Registration
>;
const installed = (readJson(resolve(claudeDir, 'plugins', 'installed_plugins.json'))?.plugins ?? {}) as Record<
  string,
  unknown
>;
const relevant = Object.entries(known).filter(
  ([name, registration]) =>
    isRecord(registration) && (name === PUBLISHED.name || name === devName || `${plugin}@${name}` in installed)
);
const validIds: string[] = [];
const renamed = new Map<string, string>();
for (const [name, registration] of relevant) {
  const source = registration.source ?? {};
  if (source.source === 'directory' && source.path) {
    const catalog = catalogName(source.path);
    if (catalog && catalog !== name) {
      findings.push({
        host: 'claude',
        kind: 'renamed-catalog',
        detail: `Marketplace "${name}" is registered from ${source.path}, whose catalog is now named "${catalog}"; the plugin id becomes ${plugin}@${catalog}.`,
        commands: [
          `/plugin marketplace remove ${name}`,
          `/plugin marketplace add ${source.path}`,
          `/plugin install ${plugin}@${catalog}`
        ]
      });
      renamed.set(name, catalog);
      validIds.push(`${plugin}@${catalog}`);
      continue;
    }
  }
  if (source.source === 'github' && source.repo && PUBLISHED.retired.includes(source.repo)) {
    const renamedToo = name !== PUBLISHED.name;
    findings.push({
      host: 'claude',
      kind: 'retired-marketplace',
      detail: renamedToo
        ? `Marketplace "${name}" still points at ${source.repo}; the catalog moved to ${PUBLISHED.repo}, which registers as "${PUBLISHED.name}", so the plugin id becomes ${plugin}@${PUBLISHED.name}.`
        : `Marketplace "${name}" still points at ${source.repo}; the catalog moved to ${PUBLISHED.repo} under the same name, so adding it replaces the registration and ${plugin}@${name} is unchanged.`,
      commands: [`/plugin marketplace add ${PUBLISHED.repo}`, `/plugin install ${plugin}@${PUBLISHED.name}`]
    });
    if (renamedToo) renamed.set(name, PUBLISHED.name);
    validIds.push(`${plugin}@${PUBLISHED.name}`);
    continue;
  }
  validIds.push(`${plugin}@${name}`);
}
// Both home files: the plugin keys belong in the local one, and a home not yet upgraded keeps them in the shared one.
const homeSettings = ['settings.local.json', 'settings.json'].map(
  (name) => readJson(resolve(homeDir, '.claude', name)) ?? {}
);
const keysOf = (key: string): string[] => homeSettings.flatMap((settings) => Object.keys(settings[key] ?? {}));
const enabledKey = keysOf('enabledPlugins').find((key) => key.startsWith(`${plugin}@`));
if (enabledKey && validIds.length > 0 && !validIds.includes(enabledKey)) {
  const marketplace = enabledKey.slice(plugin.length + 1);
  const target = renamed.get(marketplace);
  const installedId = validIds.find((id) => id in installed);
  settings.enabledPlugins = { from: enabledKey, to: target ? `${plugin}@${target}` : (installedId ?? validIds[0]) };
}
const staleMarketplace = keysOf('extraKnownMarketplaces').find((key) => renamed.has(key));
if (staleMarketplace) {
  settings.extraKnownMarketplaces = { from: staleMarketplace, to: String(renamed.get(staleMarketplace)) };
}

// Codex: marketplaces and plugins are user-scoped tables in config.toml.
interface CodexConfig {
  marketplaces?: Record<string, { source_type?: string; source?: string }>;
  plugins?: Record<string, unknown>;
}
const codexConfigPath = resolve(codexDir, 'config.toml');
let config: CodexConfig = {};
if (existsSync(codexConfigPath)) {
  try {
    config = Bun.TOML.parse(readFileSync(codexConfigPath, 'utf-8')) as CodexConfig;
  } catch (err) {
    warnings.push(`${codexConfigPath} did not parse: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const [name, marketplace] of Object.entries(config.marketplaces ?? {})) {
    if (!isRecord(marketplace) || marketplace.source_type !== 'local' || typeof marketplace.source !== 'string')
      continue;
    const catalog = catalogName(marketplace.source);
    if (!catalog || catalog === name || !(`${plugin}@${name}` in (config.plugins ?? {}))) continue;
    findings.push({
      host: 'codex',
      kind: 'renamed-catalog',
      detail: `Codex marketplace "${name}" is registered from ${marketplace.source}, whose catalog is now named "${catalog}"; the plugin id becomes ${plugin}@${catalog}.`,
      commands: [
        `codex plugin remove ${plugin}@${name}`,
        `codex plugin marketplace remove ${name}`,
        `codex plugin marketplace add ${marketplace.source}`,
        `codex plugin add ${plugin}@${catalog}`
      ]
    });
  }
}
const codexWired = codexHost.usedBy(homeDir);
const codexIds = codexWired ? Object.keys(config.plugins ?? {}).filter((id) => id.startsWith(`${plugin}@`)) : [];
if (codexWired && codexIds.length === 0) {
  const [source, catalog] =
    devName && existsSync(resolve(pluginRoot, '.git')) ? [pluginRoot, devName] : [PUBLISHED.repo, PUBLISHED.name];
  findings.push({
    host: 'codex',
    kind: 'not-installed',
    detail: `This home is wired for Codex, but Codex has no ${plugin} plugin, so Codex sessions here load none of its skills.`,
    commands: [`codex plugin marketplace add ${source}`, `codex plugin add ${plugin}@${catalog}`]
  });
}
// Codex reads the skills from a copy it makes at install, one folder per version, and does not refresh it when the plugin updates.
findings.push(
  ...codexIds.flatMap((id): Finding[] => {
    const marketplace = id.slice(plugin.length + 1);
    const cached = listDirs(resolve(codexDir, 'plugins', 'cache', marketplace, plugin));
    if (cached.length === 0 || cached.includes(version)) {
      return [];
    }
    const fromGit = config.marketplaces?.[marketplace]?.source_type === 'git';
    return [
      {
        host: 'codex',
        kind: 'stale-copy',
        detail: `Codex's copy of ${id} is ${cached.join(', ')}, and this plugin is ${version}, so Codex sessions here read older skills than the code they run.`,
        commands: [
          ...(fromGit ? [`codex plugin marketplace upgrade ${marketplace}`] : []),
          `codex plugin remove ${id}`,
          `codex plugin add ${id}`
        ]
      }
    ];
  })
);

// Antigravity loads the checkout its personal manifest names, in place.
const pluginsManifest = resolve(geminiDir, 'config', 'plugins.json');
const manifestPaths = entriesOf(readJson(pluginsManifest));
const ownCheckouts = manifestPaths.filter(
  (path) => readJson(resolve(path, '.antigravity-plugin', 'plugin.json'))?.name === plugin || !existsSync(path)
);
const loadsThis = namesCheckout(manifestPaths, pluginRoot);
if (ownCheckouts.length > 0 && !loadsThis) {
  findings.push({
    host: 'antigravity',
    kind: 'stale-path',
    detail: `${pluginsManifest} loads ${ownCheckouts.join(', ')}, not this checkout (${pluginRoot}), so Antigravity runs other code than this release. Replace that entry's path with this checkout's (the note the upgrade writes has the line).`,
    commands: []
  });
}
if ((loadsThis || ownCheckouts.length > 0) && existsSync(resolve(geminiDir, 'config', 'plugins', plugin))) {
  findings.push({
    host: 'antigravity',
    kind: 'global-copy',
    detail: `Antigravity also has an installed copy of ${plugin} in ${resolve(geminiDir, 'config', 'plugins', plugin)}, which loads it a second time beside this checkout.`,
    commands: [`agy plugin uninstall ${plugin}`]
  });
}

const ok = findings.length === 0 && Object.keys(settings).length === 0;
process.stdout.write(`${JSON.stringify({ plugin, ok, findings, settings, warnings }, null, 2)}\n`);
