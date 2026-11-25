/**
 * The home's Claude rules applied by a host whose own permission rules can't hold them (path rules there take no
 * globs): every deny refused, every call that asks in Claude Code put to the operator through the host's own prompt,
 * and every MCP tool the home grants approved. Read from the home's effective settings on each call, so nothing
 * derived from them can go stale.
 */
import { gitParts, plainTexts } from '@/hooks/guard';
import { commandWords, scanShell, type ShellCommand, type ShellDialect } from '@/hooks/shell-scan';
import { mergeSettings, readMergedSettings, readSettingsFile } from '@/home/settings-scope';
import { sandboxWritesOf, workRootsOf } from '@/home/work-roots';
import type { PolicyDecision, ToolCall } from '@/hosts/contract';
import { isRecord, stringsOf } from '@/shared/json-block';
import { PLUGIN_SOURCE_ROOT, pluginName, RUNTIME_DIR } from '@/shared/naming';
import { fixedPrefix, isInside, nativeForm, pathKey, resolvedPath } from '@/shared/paths';
import { homedir, tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';

type Json = Record<string, unknown>;

export interface PolicyContext {
  home: string;
  /** The folder relative paths in the call are read against. */
  cwd: string;
  /** The home's effective Claude settings: the user-level file under the home's two. */
  settings: Json;
  /** Folders the host keeps for the session itself, inside the home's bounds. */
  hostFolders?: string[];
  /** The platform the call's paths are spelled for; this machine's when absent. */
  platform?: NodeJS.Platform;
  /** The language of the host's shell commands; POSIX when absent. */
  shell?: ShellDialect;
}

/** What a home holds that the host's tools never write: the rules, and every host's wiring. */
export const WIRING = ['.agents', '.claude', '.codex', '.mcp.json'];
const FROM_CLAUDE = 'Claude Code asks before this';
const WRAPPERS = new Set(['command', 'env', 'exec', 'nice', 'nohup', 'sudo', 'time', 'timeout', 'xargs']);
/** A wrapper's own flags, assignments and numbers (`env A=1`, `nice -n 5`, `timeout 10`) come before the command it runs. */
const WRAPPER_ARGUMENT = /^-|=|^\d+[a-z]?$/;
/** A shell's flag that runs its next word as a script: `-c`, or one in a cluster (`-lc`, `-ec`). */
const SCRIPT_FLAG = /^-[a-z]*c[a-z]*$/;
const POWERSHELL_FLAG = /^-(?:c|command)$/i;
/** Each shell that runs a script it is handed, the flag that hands it over, and how that script is written. */
const SHELLS: Record<string, { flag: RegExp; dialect: ShellDialect }> = {
  sh: { flag: SCRIPT_FLAG, dialect: 'posix' },
  bash: { flag: SCRIPT_FLAG, dialect: 'posix' },
  zsh: { flag: SCRIPT_FLAG, dialect: 'posix' },
  pwsh: { flag: POWERSHELL_FLAG, dialect: 'powershell' },
  powershell: { flag: POWERSHELL_FLAG, dialect: 'powershell' },
  // cmd escapes with `^`, but like PowerShell it reads a backslash as a plain character.
  cmd: { flag: /^\/[ck]$/i, dialect: 'powershell' }
};
const HOME_WORD: Record<ShellDialect, RegExp> = {
  posix: /^(?:~|\$HOME|\$\{HOME\})(?=$|\/)/,
  powershell: /^(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|\$\{env:USERPROFILE\})(?=$|[\\/])/i
};

/** A command word as rules name it: its base name, either separator, without Windows' `.exe`. */
const commandName = (word: string): string => win32.basename(word).replace(/\.exe$/i, '');

/** The script a shell runs (`sh -c 'gh pr list'`, `bash -lc …`, `pwsh -Command …`), when the words are one. */
const innerScript = (words: string[]): { script: string; dialect: ShellDialect } | undefined => {
  const shell = SHELLS[(words[0] ?? '').toLowerCase()];
  // PowerShell and cmd run the rest of the line; a POSIX shell runs the one word after its flag.
  const script = shell?.dialect === 'powershell' && words.length > 2 ? words.slice(2).join(' ') : words[2];
  return shell && script !== undefined && shell.flag.test(words[1] ?? '')
    ? { script, dialect: shell.dialect }
    : undefined;
};

/** A word naming a path from the user's home (`~/x`, `$HOME/x`, PowerShell's `$env:USERPROFILE\x`) as the path it names. */
const fromUserHome = (word: string, dialect: ShellDialect): string => word.replace(HOME_WORD[dialect], () => homedir());

/** The user-level Claude settings under the home's two, which is what Claude Code applies in the home. */
export const effectiveSettings = (home: string): Json =>
  mergeSettings(readSettingsFile(join(homedir(), '.claude', 'settings.json')), readMergedSettings(home).merged);

/** One permissions list; a list or a `permissions` that is there but malformed throws, so the check fails closed. */
const rulesOf = (settings: Json, list: 'allow' | 'ask' | 'deny'): string[] => {
  const { permissions } = settings;
  if (permissions === undefined) {
    return [];
  }
  if (!isRecord(permissions)) {
    throw new Error("the Claude settings' permissions is not an object");
  }
  const value = permissions[list];
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`the Claude settings' permissions.${list} is not a list`);
  }
  return stringsOf(value);
};

/** The bodies of one tool's rules: `Read(./x)` → `./x`. */
const bodies = (rules: string[], tool: string): string[] =>
  rules.flatMap((rule) => (rule.startsWith(`${tool}(`) && rule.endsWith(')') ? [rule.slice(tool.length + 1, -1)] : []));

/** How one decision reads and compares paths, settled once from the context. */
interface Scope {
  platform: NodeJS.Platform;
  windows: boolean;
  dialect: ShellDialect;
  home: string;
  /** A path from the call, absolute, symlinks resolved, in the platform's own form. */
  target: (path: string) => string;
  /** Symlinks resolve only on the machine the paths belong to; a path spelled for another platform stays as written. */
  canonical: (path: string) => string;
  within: (child: string, parent: string) => boolean;
  join: (...parts: string[]) => string;
}

const scopeOf = (context: PolicyContext): Scope => {
  const platform = context.platform ?? process.platform;
  const windows = platform === 'win32';
  const api = windows ? win32 : posix;
  const canonical = (path: string): string => (platform === process.platform ? resolvedPath(path) : path);
  return {
    platform,
    windows,
    dialect: context.shell ?? 'posix',
    home: canonical(context.home),
    target: (path) => canonical(api.resolve(nativeForm(context.cwd, platform), nativeForm(path, platform))),
    canonical,
    within: (child, parent) => isInside(child, parent, platform),
    join: (...parts) => api.join(...parts)
  };
};

/** A Claude path rule as an absolute glob: `//x` from the root, `~/x` from the user's home, anything else from the home. */
const absoluteGlob = (rule: string, scope: Scope): string =>
  rule.startsWith('//')
    ? rule.slice(1)
    : rule.startsWith('~/')
      ? scope.join(homedir(), rule.slice(2))
      : rule.startsWith('**')
        ? rule
        : scope.join(scope.home, rule);

/** A glob with its fixed folders resolved, so a rule written through a symlink matches the resolved path it meets. */
const resolvedGlob = (glob: string): string => {
  const fixed = fixedPrefix(glob);
  return fixed ? resolvedPath(fixed) + glob.slice(fixed.length) : glob;
};

/**
 * Path rules compiled once per decision: each glob and the folder form of it, matched against a path in the form the
 * platform compares. A Windows rule through a symlink or junction matches only as spelled (TODO(windows)).
 */
const pathMatcher = (rules: string[], scope: Scope): ((path: string) => boolean) => {
  const globs = rules
    .map((rule) => absoluteGlob(rule, scope))
    .map((glob) => (scope.windows ? pathKey(glob, scope.platform) : resolvedGlob(glob)))
    .flatMap((glob) => [new Bun.Glob(glob), new Bun.Glob(glob.replace(/\/?$/, '/**'))]);
  return (path) => {
    const key = pathKey(path, scope.platform);
    return globs.some((glob) => glob.match(key));
  };
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
  const name = commandName(first);
  if (WRAPPERS.has(name.toLowerCase())) {
    const start = rest.findIndex((word) => !WRAPPER_ARGUMENT.test(word));
    return start < 0 ? [] : commandText(rest.slice(start));
  }
  return [name, ...rest];
};

/** Each command as Claude's rules read it: the command word's base name, wrappers dropped, git's options skipped. */
const normalized = (commands: ShellCommand[]): string[] =>
  commands.flatMap((command) => {
    const words = commandText(plainTexts(command));
    const inner = innerScript(words);
    if (inner !== undefined) {
      return normalized(scanShell(inner.script, inner.dialect));
    }
    const { sub, args } = gitParts(command);
    return [(sub === undefined ? words : ['git', sub, ...args]).join(' ')];
  });

/** `Bash(x:*)` is a prefix; any other body is a glob whose `*` spans spaces. PowerShell ignores case. */
const matchesCommand = (body: string, command: string, ignoreCase: boolean): boolean => {
  const [rule, text] = ignoreCase ? [body.toLowerCase(), command.toLowerCase()] : [body, command];
  if (rule.endsWith(':*')) {
    const prefix = rule.slice(0, -2);
    return text === prefix || text.startsWith(`${prefix} `);
  }
  const pattern = new RegExp(
    `^${rule
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`
  );
  return pattern.test(text);
};

/** Every word of every command, redirection targets included: the paths a shell command could read. */
const pathWords = (commands: ShellCommand[], dialect: ShellDialect): string[] =>
  commands.flatMap((command) => {
    const inner = innerScript(commandText(plainTexts(command)));
    return inner !== undefined
      ? pathWords(scanShell(inner.script, inner.dialect), inner.dialect)
      : commandWords(command)
          .filter((word) => !word.operator)
          .map((word) => fromUserHome(word.text, dialect));
  });

const shellDecision = (command: string, bypass: boolean, context: PolicyContext, scope: Scope): PolicyDecision => {
  const commands = scanShell(command, scope.dialect);
  const texts = normalized(commands);
  // A rule written across a pipe (`curl *|sh*`) reads the whole line; the rest read each command.
  const matched = [command.trim(), ...texts];
  const powershell = scope.dialect === 'powershell';
  const shellRules = (list: 'ask' | 'deny'): string[] => {
    const rules = rulesOf(context.settings, list);
    return [...bodies(rules, 'Bash'), ...(powershell ? bodies(rules, 'PowerShell') : [])];
  };
  const denies = shellRules('deny');
  const denied = matched.find((text) => denies.some((body) => matchesCommand(body, text, powershell)));
  if (denied !== undefined) {
    return { decision: 'deny', reason: `\`${denied}\` is denied in this home.` };
  }
  const readDenied = pathMatcher(bodies(rulesOf(context.settings, 'deny'), 'Read'), scope);
  const secret = pathWords(commands, scope.dialect).find((word) => readDenied(scope.target(word)));
  if (secret !== undefined) {
    return { decision: 'deny', reason: `\`${secret}\` is a file this home denies reading.` };
  }
  const asks = shellRules('ask');
  const asked = matched.find((text) => asks.some((body) => matchesCommand(body, text, powershell)));
  if (asked !== undefined) {
    return { decision: 'force_ask', reason: `${FROM_CLAUDE}: \`${asked}\`.` };
  }
  const sandbox = isRecord(context.settings.sandbox) ? context.settings.sandbox : {};
  const excluded = stringsOf(sandbox.excludedCommands);
  if (bypass && !(texts.length === 1 && excluded.some((rule) => matchesCommand(rule, texts[0] ?? '', powershell)))) {
    return { decision: 'force_ask', reason: 'This command asks to run outside the sandbox.' };
  }
  return null;
};

/**
 * An ask for a file outside the folders the home works in: the home, the plugin, the code folders its settings name, the
 * folders the sandbox may write, the temp folder and the host's own, as Claude Code keeps its tools to its working folders.
 */
const outsideBounds = (target: string, context: PolicyContext, scope: Scope): PolicyDecision => {
  const roots = [
    scope.home,
    PLUGIN_SOURCE_ROOT,
    tmpdir(),
    ...workRootsOf(scope.home, context.settings),
    ...sandboxWritesOf(context.settings),
    ...(context.hostFolders ?? [])
  ];
  return roots.some((root) => scope.within(target, scope.canonical(root)))
    ? null
    : {
        decision: 'force_ask',
        reason: `${target} is outside this home's folders (the home, its code folders and the plugin).`
      };
};

const pathDecision = (
  kind: 'read' | 'write' | 'search',
  path: string,
  context: PolicyContext,
  scope: Scope
): PolicyDecision => {
  const target = scope.target(path);
  const deny = rulesOf(context.settings, 'deny');
  const readDenies = bodies(deny, 'Read');
  if (kind === 'search') {
    const anchors = [
      scope.join(scope.home, RUNTIME_DIR, 'secrets'),
      ...readDenies.map((rule) => absoluteGlob(rule, scope))
    ].filter((anchor) => !/[*?[{]/.test(anchor));
    return anchors.some((anchor) => scope.within(scope.canonical(nativeForm(anchor, scope.platform)), target))
      ? { decision: 'deny', reason: 'This search would reach a folder the home denies; search a narrower folder.' }
      : outsideBounds(target, context, scope);
  }
  if (pathMatcher(readDenies, scope)(target)) {
    return { decision: 'deny', reason: `${target} is denied in this home.` };
  }
  if (kind === 'read') {
    return outsideBounds(target, context, scope);
  }
  if (pathMatcher([...bodies(deny, 'Edit'), ...bodies(deny, 'Write')], scope)(target)) {
    return { decision: 'deny', reason: `Writing ${target} is denied in this home.` };
  }
  return WIRING.some((name) => scope.within(target, scope.canonical(scope.join(scope.home, name))))
    ? { decision: 'deny', reason: `${target} holds the home's rules or wiring, which only the operator changes.` }
    : outsideBounds(target, context, scope);
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
      return shellDecision(call.command, call.bypass === true, context, scopeOf(context));
    case 'read':
    case 'write':
    case 'search':
      return pathDecision(call.kind, call.path, context, scopeOf(context));
    case 'mcp':
      return mcpDecision(call.server, call.tool, context);
    default:
      return null;
  }
};
