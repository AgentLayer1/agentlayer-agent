/**
 * The home's Claude rules applied by a host whose own permission rules can't hold them (path rules there take no
 * globs): every deny refused, every call that asks in Claude Code put to the operator through the host's own prompt,
 * and every MCP tool the home grants approved. Read from the home's effective settings on each call, so nothing
 * derived from them can go stale.
 */
import { gitParts, plainTexts } from '@/hooks/guard';
import { commandWords, scanShell, type ShellCommand } from '@/hooks/shell-scan';
import { mergeSettings, readMergedSettings } from '@/home/settings-scope';
import type { PolicyDecision, ToolCall } from '@/hosts/contract';
import { pluginName } from '@/shared/naming';
import { isInside } from '@/shared/paths';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

type Json = Record<string, unknown>;

export interface PolicyContext {
  home: string;
  /** The folder relative paths in the call are read against. */
  cwd: string;
  /** The home's effective Claude settings: the user-level file under the home's two. */
  settings: Json;
}

/** What a home holds that the host's tools never write: the rules, and every host's wiring. */
const WIRING = ['.agents', '.claude', '.codex', '.mcp.json'];
const FROM_CLAUDE = 'Claude Code asks before this';
const WRAPPERS = new Set(['env', 'nohup', 'nice', 'timeout']);
const SHELLS = new Set(['sh', 'bash', 'zsh']);
/** A wrapper's own flags, assignments and numbers (`env A=1`, `nice -n 5`, `timeout 10`) come before the command it runs. */
const WRAPPER_ARGUMENT = /^-|=|^\d+[a-z]?$/;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readJson = (path: string): Json => {
  if (!existsSync(path)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  return isObject(parsed) ? parsed : {};
};

/** The user-level Claude settings under the home's two, which is what Claude Code applies in the home. */
export const effectiveSettings = (home: string): Json =>
  mergeSettings(readJson(join(homedir(), '.claude', 'settings.json')), readMergedSettings(home).merged);

const rulesOf = (settings: Json, list: 'allow' | 'ask' | 'deny'): string[] => {
  const value = isObject(settings.permissions) ? settings.permissions[list] : undefined;
  return Array.isArray(value) ? value.filter((rule): rule is string => typeof rule === 'string') : [];
};

/** The bodies of one tool's rules: `Read(./x)` → `./x`. */
const bodies = (rules: string[], tool: string): string[] =>
  rules.flatMap((rule) => (rule.startsWith(`${tool}(`) && rule.endsWith(')') ? [rule.slice(tool.length + 1, -1)] : []));

/** A path as the host checks it: symlinks resolved through the longest part of it that exists and can be read. */
const resolvedPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(resolvedPath(parent), basename(path));
  }
};

/** A Claude path rule as an absolute glob: `//x` from the root, `~/x` from the user's home, anything else from the home. */
const absoluteGlob = (rule: string, home: string): string =>
  rule.startsWith('//')
    ? rule.slice(1)
    : rule.startsWith('~/')
      ? join(homedir(), rule.slice(2))
      : rule.startsWith('**')
        ? rule
        : join(home, rule);

const matchesPath = (rule: string, path: string, home: string): boolean => {
  const glob = absoluteGlob(rule, home);
  return [glob, glob.replace(/\/?$/, '/**')].some((pattern) => new Bun.Glob(pattern).match(path));
};

/** A Claude MCP rule as a server and a tool (`*` for every tool), the plugin's own server under its plugin name. */
const mcpRule = (rule: string): { server: string; tool: string } | null => {
  const own = new RegExp(`^mcp__plugin_${pluginName()}_[^_]+__(.+)$`).exec(rule);
  if (own?.[1]) {
    return { server: pluginName(), tool: own[1] };
  }
  const other = /^mcp__([^_]+(?:_[^_]+)*?)(?:__(.+))?$/.exec(rule);
  return other?.[1] ? { server: other[1], tool: other[2] ?? '*' } : null;
};

const matchesMcp = (rules: string[], server: string, tool: string): boolean =>
  rules
    .map(mcpRule)
    .some((rule) => rule !== null && rule.server === server && (rule.tool === '*' || rule.tool === tool));

const commandText = (words: string[]): string[] => {
  const [first = '', ...rest] = words;
  const name = basename(first);
  if (WRAPPERS.has(name)) {
    const start = rest.findIndex((word) => !WRAPPER_ARGUMENT.test(word));
    return start < 0 ? [] : commandText(rest.slice(start));
  }
  return [name, ...rest];
};

/** Each command as Claude's rules read it: the command word's base name, wrappers dropped, git's options skipped. */
const normalized = (commands: ShellCommand[]): string[] =>
  commands.flatMap((command) => {
    const words = commandText(plainTexts(command));
    if (SHELLS.has(words[0] ?? '') && words[1] === '-c' && words[2] !== undefined) {
      return normalized(scanShell(words[2]));
    }
    const { sub, args } = gitParts(command);
    return [(sub === undefined ? words : ['git', sub, ...args]).join(' ')];
  });

/** `Bash(x:*)` is a prefix; any other body is a glob whose `*` spans spaces. */
const matchesCommand = (body: string, command: string): boolean => {
  if (body.endsWith(':*')) {
    const prefix = body.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  const pattern = new RegExp(
    `^${body
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`
  );
  return pattern.test(command);
};

/** Every word of every command, redirection targets included: the paths a shell command could read. */
const pathWords = (commands: ShellCommand[]): string[] =>
  commands.flatMap((command) =>
    commandWords(command)
      .filter((word) => !word.operator)
      .map((word) => word.text)
  );

const shellDecision = (command: string, bypass: boolean, context: PolicyContext): PolicyDecision => {
  const commands = scanShell(command);
  const texts = normalized(commands);
  // A rule written across a pipe (`curl *|sh*`) reads the whole line; the rest read each command.
  const matched = [command.trim(), ...texts];
  const deny = rulesOf(context.settings, 'deny');
  const denied = matched.find((text) => bodies(deny, 'Bash').some((body) => matchesCommand(body, text)));
  if (denied !== undefined) {
    return { decision: 'deny', reason: `\`${denied}\` is denied in this home.` };
  }
  const home = resolvedPath(context.home);
  const readDenies = bodies(deny, 'Read');
  const secret = pathWords(commands).find((word) =>
    readDenies.some((rule) => matchesPath(rule, resolvedPath(resolve(context.cwd, word)), home))
  );
  if (secret !== undefined) {
    return { decision: 'deny', reason: `\`${secret}\` is a file this home denies reading.` };
  }
  const asked = matched.find((text) =>
    bodies(rulesOf(context.settings, 'ask'), 'Bash').some((body) => matchesCommand(body, text))
  );
  if (asked !== undefined) {
    return { decision: 'force_ask', reason: `${FROM_CLAUDE}: \`${asked}\`.` };
  }
  const sandbox = isObject(context.settings.sandbox) ? context.settings.sandbox : {};
  const excluded = Array.isArray(sandbox.excludedCommands)
    ? sandbox.excludedCommands.filter((rule): rule is string => typeof rule === 'string')
    : [];
  if (bypass && !(texts.length === 1 && excluded.some((rule) => matchesCommand(rule, texts[0] ?? '')))) {
    return { decision: 'force_ask', reason: 'This command asks to run outside the sandbox.' };
  }
  return null;
};

const pathDecision = (kind: 'read' | 'write' | 'search', path: string, context: PolicyContext): PolicyDecision => {
  const target = resolvedPath(isAbsolute(path) ? path : resolve(context.cwd, path));
  const home = resolvedPath(context.home);
  const deny = rulesOf(context.settings, 'deny');
  const readDenies = bodies(deny, 'Read');
  if (kind === 'search') {
    const anchors = [join(home, '.state', 'secrets'), ...readDenies.map((rule) => absoluteGlob(rule, home))]
      .filter((anchor) => !/[*?[{]/.test(anchor))
      .map(resolvedPath);
    return anchors.some((anchor) => isInside(anchor, target))
      ? { decision: 'deny', reason: 'This search would reach a folder the home denies; search a narrower folder.' }
      : null;
  }
  if (readDenies.some((rule) => matchesPath(rule, target, home))) {
    return { decision: 'deny', reason: `${target} is denied in this home.` };
  }
  if (kind === 'read') {
    return null;
  }
  if ([...bodies(deny, 'Edit'), ...bodies(deny, 'Write')].some((rule) => matchesPath(rule, target, home))) {
    return { decision: 'deny', reason: `Writing ${target} is denied in this home.` };
  }
  return WIRING.map((name) => resolvedPath(join(home, name))).some((folder) => isInside(target, folder))
    ? { decision: 'deny', reason: `${target} holds the home's rules or wiring, which only the operator changes.` }
    : null;
};

const mcpDecision = (server: string, tool: string, context: PolicyContext): PolicyDecision => {
  if (matchesMcp(rulesOf(context.settings, 'deny'), server, tool)) {
    return { decision: 'deny', reason: `${server}/${tool} is denied in this home.` };
  }
  if (matchesMcp(rulesOf(context.settings, 'ask'), server, tool)) {
    return { decision: 'force_ask', reason: `${FROM_CLAUDE}: ${server}/${tool}.` };
  }
  return matchesMcp(rulesOf(context.settings, 'allow'), server, tool) ? { decision: 'auto_approve' } : null;
};

/** What the home's rules decide for this call; null leaves it to the host's own permissions. */
export const policyDecision = (call: ToolCall, context: PolicyContext): PolicyDecision => {
  switch (call.kind) {
    case 'shell':
      return shellDecision(call.command, call.bypass === true, context);
    case 'read':
    case 'write':
    case 'search':
      return pathDecision(call.kind, call.path, context);
    case 'mcp':
      return mcpDecision(call.server, call.tool, context);
    default:
      return null;
  }
};
