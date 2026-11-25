/**
 * The home's Claude rules applied by a host whose own permission rules can't hold them (path rules there take no
 * globs): every deny refused, every call that asks in Claude Code put to the operator through the host's own prompt,
 * and every MCP tool the home grants approved. Read from the home's effective settings on each call, so nothing
 * derived from them can go stale.
 */
import { gitParts, plainTexts } from '@/hooks/guard';
import { commandWords, scanShell, type ShellCommand, type ShellDialect } from '@/hooks/shell-scan';
import { mergeSettings, readMergedSettings, readSettingsFile } from '@/home/settings-scope';
import { workRootsOf } from '@/home/work-roots';
import type { PolicyDecision, ToolCall } from '@/hosts/contract';
import { isRecord } from '@/shared/json-block';
import { PLUGIN_SOURCE_ROOT, pluginName, RUNTIME_DIR } from '@/shared/naming';
import { claudeForm, driveForm, expandTilde, isInside, resolvedPath } from '@/shared/paths';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, posix, win32 } from 'node:path';

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

const onWindows = (context: PolicyContext): boolean => (context.platform ?? process.platform) === 'win32';

/** A command word as rules name it: its base name, and on Windows without `.exe`. */
const commandName = (word: string, windows: boolean): string =>
  windows ? win32.basename(word).replace(/\.exe$/i, '') : posix.basename(word);

/** The script a shell runs (`sh -c 'gh pr list'`, `bash -lc …`, `pwsh -Command …`), when the words are one. */
const innerScript = (words: string[], windows: boolean): { script: string; dialect: ShellDialect } | undefined => {
  const name = words[0] ?? '';
  const shell = SHELLS[windows ? name.toLowerCase() : name];
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
  return (value ?? []).filter((rule): rule is string => typeof rule === 'string');
};

/** The bodies of one tool's rules: `Read(./x)` → `./x`. */
const bodies = (rules: string[], tool: string): string[] =>
  rules.flatMap((rule) => (rule.startsWith(`${tool}(`) && rule.endsWith(')') ? [rule.slice(tool.length + 1, -1)] : []));

const pathsOf = (windows: boolean): typeof posix => (windows ? win32 : posix);

/** Symlinks resolve only on the machine the paths belong to; a path spelled for another platform is compared as written. */
const canonical = (path: string, context: PolicyContext): string =>
  (context.platform ?? process.platform) === process.platform ? resolvedPath(path) : path;

/** A path as rules compare it: on Windows in Claude's rule form (`/c/Users/…`) and lower case, as its file system ignores case. */
const comparable = (path: string, windows: boolean): string => (windows ? claudeForm(path).toLowerCase() : path);

const within = (child: string, parent: string, windows: boolean): boolean => {
  if (!windows) {
    return isInside(child, parent);
  }
  const folder = comparable(parent, true).replace(/\/+$/, '');
  const path = comparable(child, true);
  return path === folder || path.startsWith(`${folder}/`);
};

/** A path from the call, absolute, symlinks resolved, in the platform's own form; Git Bash's `/c/…` is read as `C:\…`. */
const targetOf = (path: string, context: PolicyContext): string => {
  const windows = onWindows(context);
  const native = (spelled: string): string => (windows ? driveForm(spelled) : spelled);
  return canonical(pathsOf(windows).resolve(native(context.cwd), native(path)), context);
};

/** A Claude path rule as an absolute glob: `//x` from the root, `~/x` from the user's home, anything else from the home. */
const absoluteGlob = (rule: string, home: string, windows: boolean): string =>
  rule.startsWith('//')
    ? rule.slice(1)
    : rule.startsWith('~/')
      ? pathsOf(windows).join(homedir(), rule.slice(2))
      : rule.startsWith('**')
        ? rule
        : pathsOf(windows).join(home, rule);

/** A glob with its fixed folders resolved, so a rule written through a symlink matches the resolved path it meets. */
const resolvedGlob = (glob: string): string => {
  const segments = glob.split('/');
  const wild = segments.findIndex((segment) => /[*?[\]{}]/.test(segment));
  const fixed = (wild === -1 ? segments : segments.slice(0, wild)).join('/');
  return fixed ? [resolvedPath(fixed), ...(wild === -1 ? [] : segments.slice(wild))].join('/') : glob;
};

// TODO(windows): a rule written through a symlink or junction matches only as spelled; resolving it needs a Windows run.
const matchesPath = (rule: string, path: string, home: string, windows: boolean): boolean => {
  const absolute = absoluteGlob(rule, home, windows);
  const glob = windows ? comparable(absolute, true) : resolvedGlob(absolute);
  const target = comparable(path, windows);
  return [glob, glob.replace(/\/?$/, '/**')].some((pattern) => new Bun.Glob(pattern).match(target));
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

const commandText = (words: string[], windows: boolean): string[] => {
  const [first = '', ...rest] = words;
  const name = commandName(first, windows);
  if (WRAPPERS.has(windows ? name.toLowerCase() : name)) {
    const start = rest.findIndex((word) => !WRAPPER_ARGUMENT.test(word));
    return start < 0 ? [] : commandText(rest.slice(start), windows);
  }
  return [name, ...rest];
};

/** Each command as Claude's rules read it: the command word's base name, wrappers dropped, git's options skipped. */
const normalized = (commands: ShellCommand[], windows: boolean): string[] =>
  commands.flatMap((command) => {
    const words = commandText(plainTexts(command), windows);
    const inner = innerScript(words, windows);
    if (inner !== undefined) {
      return normalized(scanShell(inner.script, inner.dialect), windows);
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
const pathWords = (commands: ShellCommand[], windows: boolean, dialect: ShellDialect): string[] =>
  commands.flatMap((command) => {
    const inner = innerScript(commandText(plainTexts(command), windows), windows);
    return inner !== undefined
      ? pathWords(scanShell(inner.script, inner.dialect), windows, inner.dialect)
      : commandWords(command)
          .filter((word) => !word.operator)
          .map((word) => fromUserHome(word.text, dialect));
  });

const shellDecision = (command: string, bypass: boolean, context: PolicyContext): PolicyDecision => {
  const windows = onWindows(context);
  const dialect = context.shell ?? 'posix';
  const commands = scanShell(command, dialect);
  const texts = normalized(commands, windows);
  // A rule written across a pipe (`curl *|sh*`) reads the whole line; the rest read each command.
  const matched = [command.trim(), ...texts];
  const powershell = dialect === 'powershell';
  const shellRules = (list: 'ask' | 'deny'): string[] => {
    const rules = rulesOf(context.settings, list);
    return [...bodies(rules, 'Bash'), ...(powershell ? bodies(rules, 'PowerShell') : [])];
  };
  const denied = matched.find((text) => shellRules('deny').some((body) => matchesCommand(body, text, powershell)));
  if (denied !== undefined) {
    return { decision: 'deny', reason: `\`${denied}\` is denied in this home.` };
  }
  const home = canonical(context.home, context);
  const readDenies = bodies(rulesOf(context.settings, 'deny'), 'Read');
  const secret = pathWords(commands, windows, dialect).find((word) =>
    readDenies.some((rule) => matchesPath(rule, targetOf(word, context), home, windows))
  );
  if (secret !== undefined) {
    return { decision: 'deny', reason: `\`${secret}\` is a file this home denies reading.` };
  }
  const asked = matched.find((text) => shellRules('ask').some((body) => matchesCommand(body, text, powershell)));
  if (asked !== undefined) {
    return { decision: 'force_ask', reason: `${FROM_CLAUDE}: \`${asked}\`.` };
  }
  const sandbox = isRecord(context.settings.sandbox) ? context.settings.sandbox : {};
  const excluded = Array.isArray(sandbox.excludedCommands)
    ? sandbox.excludedCommands.filter((rule): rule is string => typeof rule === 'string')
    : [];
  if (bypass && !(texts.length === 1 && excluded.some((rule) => matchesCommand(rule, texts[0] ?? '', powershell)))) {
    return { decision: 'force_ask', reason: 'This command asks to run outside the sandbox.' };
  }
  return null;
};

/**
 * An ask for a file outside the folders the home works in: the home, the plugin, the code folders its settings name, the
 * folders the sandbox may write, the temp folder and the host's own, as Claude Code keeps its tools to its working folders.
 */
const outsideBounds = (target: string, home: string, context: PolicyContext): PolicyDecision => {
  const sandbox = isRecord(context.settings.sandbox) ? context.settings.sandbox : {};
  const filesystem = isRecord(sandbox.filesystem) ? sandbox.filesystem : {};
  const writable = Array.isArray(filesystem.allowWrite)
    ? filesystem.allowWrite.filter((path): path is string => typeof path === 'string').map(expandTilde)
    : [];
  const roots = [
    home,
    PLUGIN_SOURCE_ROOT,
    tmpdir(),
    ...workRootsOf(home, context.settings),
    ...writable.filter((path) => isAbsolute(path)),
    ...(context.hostFolders ?? [])
  ].map((root) => canonical(root, context));
  return roots.some((root) => within(target, root, onWindows(context)))
    ? null
    : {
        decision: 'force_ask',
        reason: `${target} is outside this home's folders (the home, its code folders and the plugin).`
      };
};

const pathDecision = (kind: 'read' | 'write' | 'search', path: string, context: PolicyContext): PolicyDecision => {
  const windows = onWindows(context);
  const target = targetOf(path, context);
  const home = canonical(context.home, context);
  const deny = rulesOf(context.settings, 'deny');
  const readDenies = bodies(deny, 'Read');
  const outside = outsideBounds(target, home, context);
  if (kind === 'search') {
    const anchors = [
      pathsOf(windows).join(home, RUNTIME_DIR, 'secrets'),
      ...readDenies.map((rule) => absoluteGlob(rule, home, windows))
    ]
      .filter((anchor) => !/[*?[{]/.test(anchor))
      .map((anchor) => canonical(windows ? driveForm(anchor) : anchor, context));
    return anchors.some((anchor) => within(anchor, target, windows))
      ? { decision: 'deny', reason: 'This search would reach a folder the home denies; search a narrower folder.' }
      : outside;
  }
  if (readDenies.some((rule) => matchesPath(rule, target, home, windows))) {
    return { decision: 'deny', reason: `${target} is denied in this home.` };
  }
  if (kind === 'read') {
    return outside;
  }
  if ([...bodies(deny, 'Edit'), ...bodies(deny, 'Write')].some((rule) => matchesPath(rule, target, home, windows))) {
    return { decision: 'deny', reason: `Writing ${target} is denied in this home.` };
  }
  return WIRING.map((name) => canonical(pathsOf(windows).join(home, name), context)).some((folder) =>
    within(target, folder, windows)
  )
    ? { decision: 'deny', reason: `${target} holds the home's rules or wiring, which only the operator changes.` }
    : outside;
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
