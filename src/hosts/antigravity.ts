import { FILES, staticContextFiles } from '@/config';
import type { HookPayload, HostAdapter } from '@/hosts/contract';
import { PLUGIN_SOURCE_ROOT, pluginName } from '@/shared/naming';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

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
  hookEventName?: string;
  lastUserInput?: string;
  toolCall?: { name?: string; args?: Record<string, unknown> };
}

const readPayload = (raw: string): HookPayload => {
  const parsed = JSON.parse(raw) as AntigravityPayload;
  const command = parsed.toolCall?.name === 'run_command' ? parsed.toolCall.args?.CommandLine : undefined;
  // A subagent's hooks carry no user input, and at its start its transcript doesn't exist yet.
  const child =
    parsed.lastUserInput === '' &&
    (parsed.hookEventName !== 'SessionStart' || !parsed.transcriptPath || !existsSync(parsed.transcriptPath));
  return {
    sessionId: parsed.conversationId,
    transcriptPath: parsed.transcriptPath,
    cwd: parsed.cwd,
    origin: child ? 'child' : 'user',
    call: typeof command === 'string' ? { kind: 'shell', command } : { kind: 'other' }
  };
};

/** A line cut into runs of at most `max` UTF-8 bytes, never inside a character. */
const cutLine = (line: string, max: number): string[] =>
  [...line].reduce<string[]>(
    (runs, char) => {
      const last = runs.at(-1) ?? '';
      return Buffer.byteLength(last + char) > max ? [...runs, char] : [...runs.slice(0, -1), last + char];
    },
    ['']
  );

/** Text split into pieces of at most `max` UTF-8 bytes, at line breaks where it can; joining them restores it. */
export const splitPieces = (text: string, max: number = PIECE_BYTES): string[] =>
  text
    .split(/(?<=\n)/)
    .flatMap((line) => (Buffer.byteLength(line) > max ? cutLine(line, max) : [line]))
    .reduce<string[]>((pieces, line) => {
      const last = pieces.at(-1);
      return last !== undefined && Buffer.byteLength(last + line) <= max
        ? [...pieces.slice(0, -1), last + line]
        : [...pieces, line];
    }, [])
    .filter((piece) => piece.length > 0);

const injectSteps = (pieces: string[]): string =>
  JSON.stringify({ injectSteps: pieces.map((piece) => ({ systemMessage: { systemMessage: piece } })) });

export const antigravityHost = {
  name: 'antigravity',
  readPayload,
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
  launchIssue: () => null,
  delivery: {
    kind: 'inject',
    files: () => [FILES.AGENTS, ...staticContextFiles()],
    glossary: {
      pluginRoot: `two folders above the skill's SKILL.md (for ${pluginName()}'s skills, \`${PLUGIN_SOURCE_ROOT}\`)`,
      skillDir: 'the folder holding the SKILL.md',
      toolPrefix: `\`call_mcp_tool\` with the agent's server as \`ServerName\` (the one ending \`_agent\` that offers \`ping\`) and the tool as \`ToolName\`; another server's \`mcp__<server>__<tool>\` is \`call_mcp_tool\` with that server's name`,
      askUser: '`ask_question`',
      subagent: '`invoke_subagent`',
      skill:
        'the skill by its name ("use the <name> skill"); when the body you were given stops before the skill does, read the rest from its SKILL.md in ranges',
      webSearch: '`search_web`',
      webFetch: "the agent's `browser_markdown` tool; `curl` only for the home's allowed network domains"
    }
  }
} satisfies HostAdapter;
