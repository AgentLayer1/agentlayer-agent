import { FILES, staticContextFiles } from '@/config';
import type { HookPayload, HostAdapter, ToolCall } from '@/hosts/contract';
import { PLUGIN_SOURCE_ROOT, pluginName } from '@/shared/naming';
import { homeInPayload } from '@/shared/settings-env';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';

/** Antigravity keeps about 48,900 bytes of one injected message; each piece stays well under that. */
export const PIECE_BYTES = 45_000;

/** The user's discovery manifest for plugins, which loads this checkout in place in every workspace. */
export const personalManifest = (): string => resolve(homedir(), '.gemini', 'config', 'plugins.json');

const realpath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** The Antigravity CLI's user settings, the only place it keeps permission rules and the sandbox switch. */
export const cliSettings = (): string => resolve(homedir(), '.gemini', 'antigravity-cli', 'settings.json');

/** Whether CLI settings turn the terminal sandbox on in every mode (it is otherwise on only in auto mode). */
export const sandboxOnIn = (settingsPath: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'enableTerminalSandbox' in parsed &&
      parsed.enableTerminalSandbox === true
    );
  } catch {
    return false;
  }
};

/** Whether a discovery manifest loads the checkout at `root`, however the path to it is spelled. */
export const manifestLoads = (manifest: string, root: string): boolean => {
  if (!existsSync(manifest)) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf-8'));
    const entries = typeof parsed === 'object' && parsed !== null && 'entries' in parsed ? parsed.entries : undefined;
    return (
      Array.isArray(entries) &&
      entries.some(
        (entry: unknown) =>
          typeof entry === 'object' &&
          entry !== null &&
          'path' in entry &&
          typeof entry.path === 'string' &&
          realpath(entry.path) === realpath(root)
      )
    );
  } catch {
    return false;
  }
};

interface AntigravityPayload {
  conversationId?: string;
  transcriptPath?: string;
  cwd?: string;
  workspacePaths?: string[];
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
    call: toolCallOf(parsed),
    home: homeInPayload(raw)
  };
};

/** UTF-8 bytes cut into runs of at most `max`, each ending on a character boundary. */
const cutBytes = (bytes: Buffer, max: number): Buffer[] => {
  if (bytes.length <= max) {
    return bytes.length > 0 ? [bytes] : [];
  }
  // A continuation byte (10xxxxxx) sits inside a character, so the cut steps back to the byte that starts one.
  const end = [...Array(max).keys()].map((back) => max - back).find((at) => ((bytes[at] ?? 0) & 0xc0) !== 0x80) ?? max;
  return [bytes.subarray(0, end), ...cutBytes(bytes.subarray(end), max)];
};

/** Text split into pieces of at most `max` UTF-8 bytes, at line breaks where it can; joining them restores it. */
export const splitPieces = (text: string, max: number = PIECE_BYTES): string[] =>
  text
    .split(/(?<=\n)/)
    .flatMap((line) => cutBytes(Buffer.from(line), max))
    .reduce<Buffer[][]>((pieces, line) => {
      const last = pieces.at(-1);
      const size = last?.reduce((total, part) => total + part.length, 0) ?? Infinity;
      return last !== undefined && size + line.length <= max
        ? [...pieces.slice(0, -1), [...last, line]]
        : [...pieces, [line]];
    }, [])
    .map((parts) => Buffer.concat(parts).toString('utf-8'));

const injectSteps = (pieces: string[]): string =>
  JSON.stringify({ injectSteps: pieces.map((piece) => ({ systemMessage: { systemMessage: piece } })) });

export const antigravityHost = {
  name: 'antigravity',
  readPayload,
  homeFromPayload: true,
  policyReply: (decision) => (decision === null ? { code: 0 } : { stdout: JSON.stringify(decision), code: 0 }),
  // Antigravity reads a JSON reply on exit 0; `{}` would refuse the call, so a pass writes nothing.
  guardReply: (refusal) =>
    refusal === null ? { code: 0 } : { stdout: JSON.stringify({ decision: 'deny', reason: refusal }), code: 0 },
  sessionStartReply: (result) => {
    if (result.error) {
      return {
        stdout: injectSteps([`<!-- ${pluginName()}: the agent's context could not be loaded: ${result.error} -->`]),
        code: 0
      };
    }
    const banner = result.systemMessage.trim()
      ? `<!-- session banner: mention its warnings and notices in your first reply, unless the request asks for a set output format -->\n${result.systemMessage.trim()}\n\n`
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
  launchIssue: () =>
    sandboxOnIn(cliSettings())
      ? null
      : {
          label: 'Sandbox',
          banner:
            "Antigravity's terminal sandbox isn't on for this machine, so shell commands can reach your whole disk. Paste the settings from .state/updates/antigravity-user-config.md (the upgrade skill, run from Claude Code, writes it).",
          section:
            "## ⚠️ Sandbox\n\nAntigravity's terminal sandbox isn't switched on in this machine's settings, so outside auto mode shell commands run with nothing between them and the rest of the disk. **Tell the operator before anything else**: paste the settings in `.state/updates/antigravity-user-config.md` into `~/.gemini/antigravity-cli/settings.json` (the upgrade skill, run from Claude Code, writes that note), then restart Antigravity."
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
