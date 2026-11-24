#!/usr/bin/env bun
/**
 * The user-level Antigravity setup, as a paste-ready note: the personal discovery manifest entry that loads this
 * checkout in place, and the CLI settings that keep every session safe wherever it starts (the terminal sandbox on,
 * the user-level Claude denies, the home's secrets, the folders and domains the agent works with). Antigravity keeps
 * permission rules only in its user-level settings, so a home's posture lands there; the plugin never writes either
 * file. It prints what is missing and, with `--out`, saves a note the operator can open after the session.
 *
 * Path rules name resolved paths and take no globs (a glob breaks every shell command), so a Claude deny with a
 * wildcard becomes its fixed folder when that folder holds none of the agent's work, and otherwise stays with the
 * agent's policy hook, which enforces the pattern itself in a home.
 *
 * Usage: antigravity-user-config.ts --home <dir> [--plugin-root <dir>] [--manifest <file>] [--settings <file>]
 *        [--claude-settings <file>] [--out <file>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { readMergedSettings } from '../../../src/home/settings-scope';
import { PLUGIN_SOURCE_ROOT, RUNTIME_DIR } from '../../../src/shared/naming';
import { isInside, resolvedPath } from '../../../src/shared/paths';
import { denyGlobs, expandTilde, isRecord, readHomeSettings, shellPrefixes, workspaceRootsOf } from './wiring';

type Json = Record<string, unknown>;

export interface UserConfigInputs {
  home: string;
  checkout: string;
  /** The user's ~/.gemini/config/plugins.json, parsed ({} when absent). */
  manifest: Json;
  /** The user's ~/.gemini/antigravity-cli/settings.json, parsed ({} when absent). */
  settings: Json;
  /** The user-level Claude settings, parsed. */
  claudeUser: Json;
  /** The folders the home's agent writes outside the home. */
  codeRoots: string[];
  /** The home's Claude settings, parsed and merged. */
  claudeHome: Json;
}

export interface UserConfig {
  manifest: 'current' | 'missing' | 'add-entry';
  /** The keys to merge into the CLI settings: only what the user file lacks. */
  settings: { enableTerminalSandbox?: true; permissions?: { allow?: string[]; deny?: string[] } };
  /** Claude denies a path rule can't hold, left to the policy hook inside a home. */
  heldByHook: string[];
}

const GLOB = /[*?[\]{}]/;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const at = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value);
const unique = (items: string[]): string[] => [...new Set(items)];
/** Each path once, and none inside another: a folder rule already covers what it holds. */
const outermost = (paths: string[]): string[] => {
  const once = unique(paths);
  return once.filter((path) => !once.some((other) => other !== path && isInside(path, other)));
};

/** A Claude deny glob as the path a rule can name: itself, or its fixed folder when that holds none of the work. */
const ruleTarget = (glob: string, work: string[]): string | undefined => {
  const pattern = glob.replace(/\/\*\*$/, '');
  if (!GLOB.test(pattern)) {
    return isAbsolute(pattern) ? resolvedPath(pattern) : undefined;
  }
  const segments = pattern.split('/');
  const fixed = segments
    .slice(
      0,
      segments.findIndex((segment) => GLOB.test(segment))
    )
    .join('/');
  const broad = !fixed || !isAbsolute(fixed) || [...work, homedir()].some((root) => isInside(root, fixed));
  return broad ? undefined : resolvedPath(fixed);
};

export const buildUserConfig = (inputs: UserConfigInputs): UserConfig => {
  const { home, checkout } = inputs;
  const entries = at(inputs.manifest, 'entries');
  const named = Array.isArray(entries)
    ? entries.some(
        (entry) => isRecord(entry) && typeof entry.path === 'string' && resolvedPath(entry.path) === checkout
      )
    : false;
  const work = [home, checkout, ...inputs.codeRoots];
  const userDenies = strings(at(inputs.claudeUser, 'permissions', 'deny'));
  const readGlobs = denyGlobs(userDenies);
  const editGlobs = userDenies
    .map((rule) => /^(?:Edit|Write)\((.+)\)$/.exec(rule)?.[1] ?? '')
    .filter(Boolean)
    .map(expandTilde);
  const readTargets = readGlobs.map((glob) => ruleTarget(glob, work));
  const editTargets = editGlobs.map((glob) => ruleTarget(glob, work));
  const domains = [
    ...strings(at(inputs.claudeUser, 'sandbox', 'network', 'allowedDomains')),
    ...strings(at(inputs.claudeHome, 'sandbox', 'network', 'allowedDomains'))
  ].map((domain) => domain.replace(/^\*\./, ''));
  const writable = [
    ...inputs.codeRoots,
    ...strings(at(inputs.claudeHome, 'sandbox', 'filesystem', 'allowWrite')).map(expandTilde)
  ].filter((path) => isAbsolute(path) && !GLOB.test(path));

  const unread = outermost([
    resolvedPath(join(home, RUNTIME_DIR, 'secrets')),
    ...readTargets.filter((path): path is string => path !== undefined)
  ]);
  // A read deny already denies writing there.
  const unwritten = outermost(editTargets.filter((path): path is string => path !== undefined)).filter(
    (path) => !unread.some((folder) => isInside(path, folder))
  );
  const wanted = {
    deny: [
      ...unread.map((path) => `read_file(${path})`),
      ...unwritten.map((path) => `write_file(${path})`),
      ...unique(shellPrefixes(userDenies)).map((prefix) => `command(${prefix})`)
    ],
    allow: [
      `read_file(${checkout})`,
      ...outermost(writable.map(resolvedPath)).map((path) => `write_file(${path})`),
      ...unique(domains).map((domain) => `read_url(${domain})`)
    ]
  };
  const have = (list: 'allow' | 'deny'): Set<string> => new Set(strings(at(inputs.settings, 'permissions', list)));
  const missingDeny = wanted.deny.filter((rule) => !have('deny').has(rule));
  const missingAllow = wanted.allow.filter((rule) => !have('allow').has(rule));
  const permissions = {
    ...(missingAllow.length > 0 ? { allow: missingAllow } : {}),
    ...(missingDeny.length > 0 ? { deny: missingDeny } : {})
  };
  return {
    manifest: named ? 'current' : Array.isArray(entries) ? 'add-entry' : 'missing',
    settings: {
      ...(at(inputs.settings, 'enableTerminalSandbox') === true ? {} : { enableTerminalSandbox: true }),
      ...(Object.keys(permissions).length > 0 ? { permissions } : {})
    },
    heldByHook: [
      ...readGlobs.filter((_glob, index) => readTargets[index] === undefined),
      ...editGlobs.filter((_glob, index) => editTargets[index] === undefined)
    ]
  };
};

const readJson = (path: string): Json => {
  if (!existsSync(path)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  return isRecord(parsed) && !Array.isArray(parsed) ? parsed : {};
};

const note = (config: UserConfig, paths: { manifest: string; settings: string }, checkout: string): string => {
  const fence = (value: unknown): string[] => ['```json', JSON.stringify(value, null, 2), '```'];
  const manifestPart =
    config.manifest === 'current'
      ? [`**Plugin: loaded.** \`${paths.manifest}\` already names this checkout.`]
      : config.manifest === 'missing'
        ? [
            `**Plugin: not loaded yet.** Create \`${paths.manifest}\` with this, or add its \`entries\` to the file you have:`,
            '',
            ...fence({ entries: [{ path: checkout }] })
          ]
        : [
            `**Plugin: not loaded yet.** Add this entry to \`entries\` in \`${paths.manifest}\`:`,
            '',
            ...fence({ path: checkout })
          ];
  const settingsPart =
    Object.keys(config.settings).length === 0
      ? [`**Settings: current.** \`${paths.settings}\` already has every key below.`]
      : [
          `**Settings: missing keys.** Merge these into \`${paths.settings}\`; add each rule to the list of the same`,
          'name rather than replacing the list:',
          '',
          ...fence(config.settings)
        ];
  const hookPart =
    config.heldByHook.length === 0
      ? []
      : [
          '',
          'These Claude denies hold a wildcard an Antigravity path rule can’t name. Inside an agent home the',
          'agent’s policy hook refuses them; outside the workspace the sandbox sees nothing anyway; in another',
          'project’s own folder, Antigravity can read them (its sandbox did not block `cat .env` in a probe):',
          '',
          ...config.heldByHook.map((glob) => `- \`${glob}\``)
        ];
  return [
    '# Antigravity user settings',
    '',
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by the plugin, which never edits`,
    'these files. The first loads the agent in Antigravity from this checkout, in every folder (it stays silent',
    'outside an agent home); the second keeps every Antigravity session on this machine sandboxed and away from',
    'your credentials, wherever it starts.',
    '',
    ...manifestPart,
    '',
    ...settingsPart,
    ...hookPart,
    ''
  ].join('\n');
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? undefined : args[index + 1];
  };
  const homeArg = flag('home');
  if (!homeArg) {
    process.stderr.write(
      'usage: antigravity-user-config.ts --home <dir> [--plugin-root <dir>] [--manifest <file>] [--settings <file>] [--claude-settings <file>] [--out <file>]\n'
    );
    process.exit(2);
  }
  const home = resolvedPath(resolve(homeArg));
  const paths = {
    manifest: flag('manifest') ?? resolve(homedir(), '.gemini', 'config', 'plugins.json'),
    settings: flag('settings') ?? resolve(homedir(), '.gemini', 'antigravity-cli', 'settings.json')
  };
  const claudeUserPath = flag('claude-settings') ?? resolve(homedir(), '.claude', 'settings.json');
  const checkout = resolvedPath(resolve(flag('plugin-root') ?? PLUGIN_SOURCE_ROOT));
  const homeSettings = readHomeSettings(home);
  const config = buildUserConfig({
    home,
    checkout,
    manifest: readJson(paths.manifest),
    settings: readJson(paths.settings),
    claudeUser: readJson(claudeUserPath),
    codeRoots: workspaceRootsOf(home, homeSettings).map(resolvedPath),
    claudeHome: readMergedSettings(home).merged
  });
  const out = flag('out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, note(config, paths, checkout));
  }
  process.stdout.write(`${JSON.stringify({ ...config, notePath: out ?? null }, null, 2)}\n`);
}
