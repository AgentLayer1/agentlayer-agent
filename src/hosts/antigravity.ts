import { FILES, staticContextFiles } from '@/config';
import { CLAUDE_CODE_ONLY, type HookPayload, type HostAdapter, type ToolCall } from '@/hosts/contract';
import { SKILL_PREFIX } from '@/hosts/dialect';
import { isRecord } from '@/shared/json-block';
import { PLUGIN_SOURCE_ROOT, pluginName } from '@/shared/naming';
import { nativeForm, resolvedPath, samePath } from '@/shared/paths';
import { homeOfSession } from '@/shared/settings-env';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, release as osRelease } from 'node:os';
import { basename, resolve } from 'node:path';

/** Antigravity keeps about 48,900 bytes of one injected message; each piece stays well under that. */
const PIECE_BYTES = 45_000;

/** The user's discovery manifest for plugins, which loads this checkout in place in every workspace. */
export const personalManifest = (): string => resolve(homedir(), '.gemini', 'config', 'plugins.json');

/** The Antigravity CLI's user settings, the only place it keeps permission rules and the sandbox switch. */
export const cliSettings = (): string => resolve(homedir(), '.gemini', 'antigravity-cli', 'settings.json');

/** Where the CLI keeps each MCP tool's schema, which it reads with its file tool before calling the tool. */
export const toolSchemas = (): string => resolve(homedir(), '.gemini', 'antigravity-cli', 'mcp');

/** Whether CLI settings turn the terminal sandbox on in every mode (it is otherwise on only in auto mode). */
const sandboxOnIn = (settingsPath: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return isRecord(parsed) && parsed.enableTerminalSandbox === true;
  } catch {
    return false;
  }
};

const WINDOWS_SANDBOX_BUILD = 26_100;

/** What keeps Antigravity's terminal sandbox from holding on this machine, or null when it holds. */
export const sandboxProblem = (
  settingsPath: string,
  platform: NodeJS.Platform = process.platform,
  release: string = osRelease()
): string | null => {
  if (!sandboxOnIn(settingsPath)) {
    return `Antigravity's terminal sandbox is off in ${settingsPath}, so shell commands can reach the whole disk. Paste the settings from .state/updates/antigravity-user-config.md there, then restart Antigravity.`;
  }
  const build = Number(release.split('.')[2]);
  return platform === 'win32' && build < WINDOWS_SANDBOX_BUILD
    ? `Antigravity's terminal sandbox needs Windows 11 24H2 (build ${WINDOWS_SANDBOX_BUILD}) with the August 2026 update; this Windows is build ${build}, so the sandbox setting has no effect.`
    : null;
};

/** The folders a parsed discovery manifest names. */
export const entriesOf = (manifest: unknown): string[] => {
  const entries = isRecord(manifest) ? manifest.entries : undefined;
  return Array.isArray(entries)
    ? entries.flatMap((entry: unknown) => (isRecord(entry) && typeof entry.path === 'string' ? [entry.path] : []))
    : [];
};

/** The folders a discovery manifest file names; none when it is absent or unreadable. */
const manifestEntries = (manifest: string): string[] => {
  try {
    return entriesOf(JSON.parse(readFileSync(manifest, 'utf-8')));
  } catch {
    return [];
  }
};

/** Whether any of a manifest's entries is the checkout at `root`, however the path to it is spelled. */
export const namesCheckout = (entries: string[], root: string): boolean => {
  const target = resolvedPath(root);
  return entries.some((path) => samePath(resolvedPath(path), target));
};

/** Whether a discovery manifest file loads the checkout at `root`. */
export const manifestLoads = (manifest: string, root: string): boolean =>
  namesCheckout(manifestEntries(manifest), root);

interface AntigravityPayload {
  conversationId?: string;
  transcriptPath?: string;
  cwd?: string;
  workspacePaths?: string[];
  artifactDirectoryPath?: string;
  hookEventName?: string;
  lastUserInput?: string;
  toolCall?: { name?: string; args?: Record<string, unknown> };
}

/** Each file tool and the argument naming its path: the CLI's names (probe round 4) and the docs' [hooks § Supported tools]. */
const FILE_TOOLS: Record<string, { kind: 'read' | 'write' | 'search'; arg: string }> = {
  read_file: { kind: 'read', arg: 'Path' },
  view_file: { kind: 'read', arg: 'AbsolutePath' },
  list_dir: { kind: 'read', arg: 'DirectoryPath' },
  write_file: { kind: 'write', arg: 'Path' },
  edit_file: { kind: 'write', arg: 'Path' },
  write_to_file: { kind: 'write', arg: 'TargetFile' },
  replace_file_content: { kind: 'write', arg: 'TargetFile' },
  multi_replace_file_content: { kind: 'write', arg: 'TargetFile' },
  grep_search: { kind: 'search', arg: 'SearchPath' },
  find_by_name: { kind: 'search', arg: 'SearchDirectory' }
};

/** The agent's own server runs as `<plugin folder>_agent` (named after the checkout's folder, probe R5-3), read as the plugin's. */
const ownServer = (server: string): string =>
  server === `${pluginName()}_agent` || server === `${basename(PLUGIN_SOURCE_ROOT)}_agent` ? pluginName() : server;

const toolCallOf = (parsed: AntigravityPayload): ToolCall => {
  const name = parsed.toolCall?.name ?? '';
  const args = parsed.toolCall?.args ?? {};
  const text = (key: string): string | undefined => (typeof args[key] === 'string' ? args[key] : undefined);
  const command = text('CommandLine');
  if (name === 'run_command' && command !== undefined) {
    return { kind: 'shell', command, bypass: args.BypassSandbox === true };
  }
  const file = FILE_TOOLS[name];
  const path = file ? text(file.arg) : undefined;
  if (file && (path !== undefined || file.kind === 'search')) {
    return { kind: file.kind, path: path ?? parsed.cwd ?? '.' };
  }
  const server = text('ServerName');
  const tool = text('ToolName');
  return name === 'call_mcp_tool' && server !== undefined && tool !== undefined
    ? { kind: 'mcp', server: ownServer(server), tool }
    : { kind: 'other' };
};

const readPayload = (raw: string): HookPayload => {
  const parsed = JSON.parse(raw) as AntigravityPayload;
  const call = toolCallOf(parsed);
  // Reads only: a rewritten schema would change what a tool tells the model it does.
  const schemas = call.kind === 'read' || call.kind === 'search' ? [toolSchemas()] : [];
  // A subagent's hooks carry no user input, and at its start its transcript doesn't exist yet.
  const child =
    parsed.lastUserInput === '' &&
    (parsed.hookEventName !== 'SessionStart' || !parsed.transcriptPath || !existsSync(parsed.transcriptPath));
  return {
    sessionId: parsed.conversationId,
    transcriptPath: parsed.transcriptPath,
    // A command's own folder: a `cd` in an earlier command does not carry over.
    cwd:
      (parsed.toolCall?.name === 'run_command' && typeof parsed.toolCall.args?.Cwd === 'string'
        ? parsed.toolCall.args.Cwd
        : undefined) ?? parsed.cwd,
    origin: child ? 'child' : 'user',
    call,
    home: homeOfSession({
      workspacePaths: parsed.workspacePaths?.map((path) => nativeForm(path)),
      cwd: parsed.cwd === undefined ? undefined : nativeForm(parsed.cwd)
    }),
    hostFolders: [...(parsed.artifactDirectoryPath ? [parsed.artifactDirectoryPath] : []), ...schemas]
  };
};

/** UTF-8 bytes cut into runs of at most `max`, each ending on a character boundary. */
const cutBytes = (bytes: Buffer, max: number): Buffer[] => {
  if (bytes.length <= max) {
    return bytes.length > 0 ? [bytes] : [];
  }
  // A continuation byte (10xxxxxx) sits inside a character, so the cut steps back to the byte that starts one.
  const end = [0, 1, 2, 3].map((back) => max - back).find((at) => ((bytes[at] ?? 0) & 0xc0) !== 0x80) ?? max;
  return [bytes.subarray(0, end), ...cutBytes(bytes.subarray(end), max)];
};

/** Text split into pieces of at most `max` UTF-8 bytes, at line breaks where it can; joining them restores it. */
export const splitPieces = (text: string, max: number = PIECE_BYTES): string[] =>
  text
    .split(/(?<=\n)/)
    .flatMap((line) => cutBytes(Buffer.from(line), max))
    .reduce<{ parts: Buffer[]; size: number }[]>((pieces, line) => {
      const last = pieces.at(-1);
      return last !== undefined && last.size + line.length <= max
        ? [...pieces.slice(0, -1), { parts: [...last.parts, line], size: last.size + line.length }]
        : [...pieces, { parts: [line], size: line.length }];
    }, [])
    .map((piece) => Buffer.concat(piece.parts).toString('utf-8'));

const policyReply: NonNullable<HostAdapter['policyReply']> = (decision) =>
  decision === null ? { code: 0 } : { stdout: JSON.stringify(decision), code: 0 };

const injectSteps = (pieces: string[]): string =>
  JSON.stringify({ injectSteps: pieces.map((piece) => ({ systemMessage: { systemMessage: piece } })) });

export const antigravityHost = {
  name: 'antigravity',
  title: 'Antigravity',
  column: 'Agy',
  capabilities: {
    manual: {
      level: 'partial',
      note: 'Antigravity reads the first 24 KB itself; the session-start hook sends it whole'
    },
    context: { level: 'yes' },
    capture: { level: 'yes' },
    guard: { level: 'yes' },
    rules: {
      level: 'partial',
      note: 'a file only a wildcard deny covers is blocked for every program once the upgrade lists it; one created since, only by the hook'
    },
    tools: { level: 'yes' },
    skills: { level: 'partial', note: 'a skill over 24 KB is read on from its file' },
    setup: { level: 'no', note: 'run init and upgrade from Claude Code' },
    ...CLAUDE_CODE_ONLY
  },
  setup: `Run ${SKILL_PREFIX}upgrade from Claude Code, then paste the note it writes (.state/updates/antigravity-user-config.md) into your two Antigravity files`,
  readPayload,
  homeFromPayload: true,
  policyReply,
  // Antigravity reads a JSON reply on exit 0; `{}` would refuse the call, so a pass writes nothing.
  guardReply: (refusal) => policyReply(refusal === null ? null : { decision: 'deny', reason: refusal }),
  sessionStartReply: (result) => {
    if (result.error) {
      return {
        stdout: injectSteps([`<!-- ${pluginName()}: the agent's context could not be loaded: ${result.error} -->`]),
        code: 0
      };
    }
    const banner = result.systemMessage.trim()
      ? `<!-- session banner, which this host can't show the operator: open your first reply with all of it, word for word, in a \`text\` code block, unless the request asks for a set output format -->\n${result.systemMessage.replace(/^\n+/, '').trimEnd()}\n\n`
      : '';
    const pieces = splitPieces(banner + result.additionalContext);
    return pieces.length === 0 ? { code: 0 } : { stdout: injectSteps(pieces), code: 0 };
  },
  launchDir: () => undefined,
  terminal: () => false,
  captureReply: 'json',
  recordsConversations: true,
  guard: { cdCarries: false, powershellOn: (platform) => platform === 'win32' },
  floor: {
    binary: 'agy',
    version: '1.5.16',
    why: 'loading a plugin in place from a personal discovery manifest, and MCP roots',
    update: 'agy update'
  },
  skill: (name) => `the ${name} skill`,
  usedBy: () => manifestLoads(personalManifest(), PLUGIN_SOURCE_ROOT),
  homeIssues: () => [],
  machineIssues: () => {
    const problem = sandboxProblem(cliSettings());
    return problem === null ? [] : [problem];
  },
  launchIssue: () => {
    const problem = sandboxProblem(cliSettings());
    return problem === null
      ? null
      : {
          label: 'Sandbox',
          banner: problem,
          section: `## ⚠️ Sandbox\n\n${problem} **Tell the operator before anything else.** The upgrade skill, run from Claude Code, writes that note.`
        };
  },
  delivery: {
    kind: 'inject',
    files: () => [FILES.AGENTS, ...staticContextFiles()],
    glossaryIn: 'rule',
    glossary: {
      pluginRoot: "two folders above the skill's SKILL.md",
      skillDir: 'the folder holding the SKILL.md',
      toolPrefix: `\`call_mcp_tool\` with the agent's server as \`ServerName\` (the one ending \`_agent\` that offers \`ping\`) and the tool as \`ToolName\`; another server's \`mcp__<server>__<tool>\` is \`call_mcp_tool\` with that server's name`,
      askUser: '`ask_question`',
      subagent: '`invoke_subagent`',
      skill:
        'the skill by its name ("use the <name> skill"); when the body you were given stops before the skill does, read the rest from its SKILL.md in ranges',
      webSearch: '`search_web`',
      webFetch: '`read_url_content`'
    }
  }
} satisfies HostAdapter;
