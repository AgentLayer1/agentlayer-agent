/**
 * The hook verbs behind the CLI (`guard`, `session-start`, `session-capture`): each reads the
 * host's payload, calls its core, and writes the reply the host's hook protocol expects. Each
 * returns the process exit code.
 */
import { FOLDERS, isInitialized } from '@/config';
import { HOST_NAMES, isHostName, type HostAdapter } from '@/hosts/contract';
import { DEFAULT_HOST, hostNamed } from '@/hosts/registry';
import { CLI_COMMAND } from '@/shared/naming';

type Flag = (name: string) => string | undefined;

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

const hostOf = (flag: Flag): HostAdapter | undefined => {
  const value = flag('hook-protocol');
  if (value === undefined) {
    return undefined;
  }
  const host = hostNamed(value);
  if (!host) {
    throw new Error(`Unknown --hook-protocol: ${value} (supported: ${HOST_NAMES.join(', ')})`);
  }
  return host;
};

export const runGuard = async (flag: Flag): Promise<number> => {
  // A hook process runs in the session's cwd, which a Bash `cd` moves; the home still
  // resolves through the host's launch dir or --home. Outside a home
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
  const host = hostNamed(flag('hook-protocol') ?? '') ?? DEFAULT_HOST;
  const refusal = shellGuard(command, input.cwd, FOLDERS.HOME, host.guard, { launch: host.launchDir() });
  if (refusal) {
    console.error(refusal);
    return 2;
  }
  return 0;
};

export const runSessionStart = async (flag: Flag): Promise<number> => {
  const host = hostOf(flag);
  const { sessionStart, sessionStartInject } = await import('@/hooks/session-start');
  const isTerminal = host?.terminal() ?? false;
  const { rowDraws } = await import('@/notices/notices');
  const result =
    host?.delivery.kind === 'inject'
      ? await sessionStartInject(host)
      : await sessionStart({ promptRow: isTerminal && rowDraws(), color: isTerminal, host });
  if (!host) {
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
const sessionFromPayload = async (host: HostAdapter) => {
  const parsed = parseHookInput(await Bun.stdin.text());
  return {
    transcriptPath: parsed.transcript_path ?? '',
    cwd: host.launchDir() ?? parsed.cwd ?? '',
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
  const host = hostOf(flag);
  const session = host
    ? await sessionFromPayload(host)
    : { transcriptPath: flag('transcript') ?? '', cwd: flag('cwd') ?? process.cwd(), sessionId: flag('session-id') ?? 'cli' };
  const format = flag('format') ?? host?.name;
  if (format !== undefined && !isHostName(format)) {
    throw new Error(`Unknown --format: ${format} (supported: ${HOST_NAMES.join(', ')})`);
  }
  const { captureSession } = await import('@/knowledge/session-capture');
  const result = await captureSession({ ...session, mode, format });
  if (host?.captureReply !== 'envelope') {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (result.saved && mode === 'pre-compact') {
    const systemMessage = `💾 Saved ${result.turns} turn${result.turns === 1 ? '' : 's'} to ${result.filename}`;
    process.stdout.write(JSON.stringify({ systemMessage, hookSpecificOutput: { hookEventName: 'PreCompact' } }));
  }
  return 0;
};
