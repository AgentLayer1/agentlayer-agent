/**
 * The hook verbs behind the CLI (`guard`, `session-start`, `session-capture`): each reads the
 * host's payload, calls its core, and writes the reply the host's hook protocol expects. Each
 * returns the process exit code.
 */
import { FOLDERS, isInitialized } from '@/config';
import { env } from '@/shared/env';
import { CLI_COMMAND } from '@/shared/naming';

type Flag = (name: string) => string | undefined;
type HookProtocol = 'claude' | 'codex';

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_input?: { command?: unknown };
}

/**
 * Parse hook JSON arriving on stdin. Falls back to escaping unescaped
 * backslashes (a workaround for some Claude hook payload variants that
 * emit Windows-style paths without re-escaping).
 */
const parseHookInput = (raw: string): HookInput => {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/(?<!\\)\\(?!["\\])/g, '\\\\'));
  }
};

const protocolOf = (flag: Flag): HookProtocol | undefined => {
  const value = flag('hook-protocol');
  if (value === undefined || value === 'claude' || value === 'codex') {
    return value;
  }
  throw new Error(`Unknown --hook-protocol: ${value} (supported: claude, codex)`);
};

export const runGuard = async (flag: Flag): Promise<number> => {
  // A hook process runs in the session's cwd, which a Bash `cd` moves; the home still
  // resolves through the host's project dir (Claude) or --home (Codex). Outside a home
  // there is nothing to protect.
  if (!isInitialized()) {
    return 0;
  }
  const raw = await Bun.stdin.text();
  const input: HookInput = raw.trim() ? parseHookInput(raw) : {};
  const command = input.tool_input?.command;
  if (typeof command !== 'string' || !input.cwd) {
    return 0;
  }
  const { shellGuard } = await import('@/hooks/guard');
  const host = flag('hook-protocol') === 'codex' ? 'codex' : 'claude';
  const refusal = shellGuard(command, input.cwd, FOLDERS.HOME, host, { launch: env('CLAUDE_PROJECT_DIR') });
  if (refusal) {
    console.error(refusal);
    return 2;
  }
  return 0;
};

export const runSessionStart = async (flag: Flag): Promise<number> => {
  const protocol = protocolOf(flag);
  const { sessionStart, sessionStartCodex } = await import('@/hooks/session-start');
  // Only Claude Code's terminal is known to render the banner's color and to draw the mods' prompt row;
  // the banner leaves nudges and alerts to the row once the row has shown it fetches them.
  const isTerminal = protocol === 'claude' && env('CLAUDE_CODE_ENTRYPOINT') === 'cli';
  const { rowDraws } = await import('@/notices/notices');
  const result =
    protocol === 'codex' ? await sessionStartCodex() : await sessionStart({ promptRow: isTerminal && rowDraws(), color: isTerminal });
  if (!protocol) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  process.stdout.write(
    JSON.stringify({
      systemMessage: result.systemMessage,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: result.additionalContext }
    })
  );
  return result.error ? 1 : 0;
};

// Codex's hook payload uses Claude's field names (session_id, transcript_path, cwd).
const sessionFromPayload = async (protocol: HookProtocol) => {
  const parsed = parseHookInput(await Bun.stdin.text());
  return {
    transcriptPath: parsed.transcript_path ?? '',
    // Claude reports the shell's cwd, which a Bash `cd` moves; the session lives where
    // it was launched, which the host exports separately. Codex's cwd is stable.
    cwd: (protocol === 'claude' ? env('CLAUDE_PROJECT_DIR') : undefined) ?? parsed.cwd ?? '',
    sessionId: parsed.session_id ?? 'unknown'
  };
};

export const runSessionCapture = async (flag: Flag): Promise<number> => {
  const mode = flag('mode');
  if (mode !== 'session-end' && mode !== 'pre-compact') {
    throw new Error(
      `Usage: ${CLI_COMMAND} session-capture --mode=session-end|pre-compact [--hook-protocol=claude|codex] [--transcript=PATH --cwd=PATH --session-id=X] [--format=claude|codex]`
    );
  }
  const protocol = protocolOf(flag);
  const session = protocol
    ? await sessionFromPayload(protocol)
    : { transcriptPath: flag('transcript') ?? '', cwd: flag('cwd') ?? process.cwd(), sessionId: flag('session-id') ?? 'cli' };
  const format = flag('format') ?? (protocol === 'codex' ? 'codex' : undefined);
  if (format !== undefined && format !== 'claude' && format !== 'codex') {
    throw new Error(`Unknown --format: ${format} (supported: claude, codex)`);
  }
  const { captureSession } = await import('@/knowledge/session-capture');
  const result = await captureSession({ ...session, mode, format });
  if (protocol !== 'claude') {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (result.saved && mode === 'pre-compact') {
    const systemMessage = `💾 Saved ${result.turns} turn${result.turns === 1 ? '' : 's'} to ${result.filename}`;
    process.stdout.write(JSON.stringify({ systemMessage, hookSpecificOutput: { hookEventName: 'PreCompact' } }));
  }
  return 0;
};
