import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Agent naming — the bottom of the config stack: how env keys resolve, the name
 * of its runtime data dir, and how a data dir is recognised as this agent's.
 *
 * Env naming: every knob has one shared, agent-neutral `AGENT_*` name, the only
 * one code reads. Several homes can run one plugin, so a per-agent spelling could
 * never mean "this agent only"; per-home values live in the home's own settings.
 *
 * Side-effect-free by contract, and it imports nothing beyond node builtins.
 * `shared/env.ts` sits directly on top and adds secrets loading — which reads a
 * home's `secrets/.env` into `process.env` on import. Anything that needs only
 * a NAME imports from here so it doesn't drag that load in: `shared/log.ts`
 * (which must stay light enough for hook scripts), `test.ts` (which pins
 * `AGENT_HOME` before any secrets can load from the wrong home), and
 * `status/html-render.ts` (whose runtime imports must stay config-free). Keep
 * it that way.
 *
 * When adding a var, avoid names CI systems inject — Azure Pipelines sets
 * `AGENT_OS`, `AGENT_NAME`, `AGENT_HOMEDIRECTORY`, and friends on every build
 * agent.
 */

let cachedManifest: PluginManifest | undefined;

const MANIFEST_FILE = join('.claude-plugin', 'plugin.json');

/**
 * The nearest folder at or above `dir` that holds a plugin manifest.
 * Throws when there is none, since code outside a plugin has no root to name.
 */
export const pluginRootAbove = (dir: string): string => {
  if (existsSync(join(dir, MANIFEST_FILE))) {
    return dir;
  }
  const parent = dirname(dir);
  if (parent === dir) {
    throw new Error(`No ${MANIFEST_FILE} at or above this code, so the plugin root can't be found.`);
  }
  return pluginRootAbove(parent);
};

/**
 * The folder this plugin's code runs from: a repo checkout, a marketplace cache or a fork.
 * Found from this file, never an env var, so it is always the plugin whose code this is.
 */
export const PLUGIN_SOURCE_ROOT = pluginRootAbove(import.meta.dir);

const MANIFEST_PATH = resolve(PLUGIN_SOURCE_ROOT, MANIFEST_FILE);

/** The CLI that hooks, the status line and the operator's terminal run, relative to the plugin root. */
export const CLI_FILE = join('src', 'cli.ts');

/** The command that runs this plugin's CLI from anywhere: nothing puts it on a PATH. */
export const CLI_COMMAND = `bun "${resolve(PLUGIN_SOURCE_ROOT, CLI_FILE)}"`;

const brokenManifest = (reason: string, cause?: unknown): Error =>
  new Error(
    `Cannot read this plugin's name: ${reason} (${MANIFEST_PATH}). Its data dir can't be recognised. ` +
      `Fix the plugin manifest.`,
    { cause }
  );

interface PluginManifest {
  name?: unknown;
  mcpServers?: unknown;
}

/** The manifest, read once. Only a successful read is cached, so a transient failure can't poison the process. */
const manifest = (): PluginManifest => {
  if (cachedManifest === undefined) {
    try {
      cachedManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as PluginManifest;
    } catch (cause) {
      throw brokenManifest('the plugin manifest is missing or malformed', cause);
    }
  }
  return cachedManifest;
};

/** This plugin's manifest name (`agentlayer`): its slash-command namespace and the owner a home records. */
export const pluginName = (): string => {
  const { name } = manifest();
  if (typeof name !== 'string' || !name) {
    throw brokenManifest(`the plugin manifest has no usable "name"`);
  }
  return name;
};

/**
 * The agent's handle (`agent`): the key of the one MCP server the manifest declares. It names
 * that server's tools in permission rules and the agent in task frontmatter and threads.
 */
export const agentSlug = (): string => {
  const { mcpServers } = manifest();
  const keys = typeof mcpServers === 'object' && mcpServers !== null ? Object.keys(mcpServers) : [];
  const [key] = keys;
  if (keys.length !== 1 || !key) {
    throw brokenManifest('the plugin manifest must declare exactly one MCP server');
  }
  return key;
};

/**
 * Read one `process.env` value, trimmed, or `undefined` when unset/blank. `env()` in
 * `shared/env.ts` is this plus secrets loading — prefer that everywhere except
 * `shared/log.ts`, which must stay off the secrets path.
 */
export const resolveEnv = (key: string): string | undefined => process.env[key]?.trim() || undefined;

/**
 * Folder name of the agent's runtime data dir, shared by every agent: a home's
 * `version.json` records which plugin owns it. Fixed, not configurable: skill
 * text and init's secrets deny rules spell it out.
 */
export const RUNTIME_DIR = '.state';

/**
 * Files that mark a data dir as some agent's scaffolded home: the upgrade baseline
 * (`version.json`, written by init) and the compile cursor (`knowledge.json`).
 * This agent's own home is narrower: its `version.json` records this plugin.
 * The bare directory is NOT the marker — best-effort runtime writers (the
 * logger) can create the dir itself as a side effect in a tree that is not a
 * home, and a marker that can be minted that way lets a hook firing in a
 * foreign repo turn that repo into "the home" for every later guard. Both
 * files are git-tracked in a brain repo, so a fresh clone still resolves.
 */
export const HOME_MARKER_FILES = ['version.json', 'knowledge.json'] as const;

/**
 * The plugin a data dir's `version.json` says scaffolded it, or undefined when
 * the file is missing, unreadable, or predates the `plugin` field.
 */
export const recordedPlugin = (dataDir: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(dataDir, 'version.json'), 'utf-8'));
    return typeof parsed === 'object' && parsed !== null && 'plugin' in parsed && typeof parsed.plugin === 'string'
      ? parsed.plugin || undefined
      : undefined;
  } catch {
    return undefined;
  }
};

/** True when `dataDir`'s `version.json` records this plugin; the shared `.state` name proves nothing on its own. */
export const isOwnDataDir = (dataDir: string): boolean => recordedPlugin(dataDir) === pluginName();

/** `home`'s `.state` when it is this agent's data dir; undefined when `home` is not this agent's home. */
export const ownDataDir = (home: string): string | undefined => {
  const dataDir = resolve(home, RUNTIME_DIR);
  return isOwnDataDir(dataDir) ? dataDir : undefined;
};

/** Where `home` keeps its runtime state, whether or not init has written it yet. */
export const dataDirOf = (home: string): string => resolve(home, RUNTIME_DIR);
