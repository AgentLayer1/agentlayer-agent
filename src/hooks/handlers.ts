/**
 * The hook verbs behind the CLI (`guard`, `session-start`, `session-capture`): each reads the
 * host's payload, calls its core, and writes the reply the host's hook protocol expects. Each
 * returns the process exit code.
 */
import { FOLDERS, isInitialized } from '@/config';
import { HOST_NAMES, isHostName, type HookReply, type HostAdapter } from '@/hosts/contract';
import { DEFAULT_HOST, hostNamed } from '@/hosts/registry';
import { CLI_COMMAND } from '@/shared/naming';

type Flag = (name: string) => string | undefined;

const emit = (reply: HookReply): number => {
  if (reply.stdout !== undefined) {
    process.stdout.write(reply.stdout);
  }
  if (reply.stderr !== undefined) {
    process.stderr.write(reply.stderr);
  }
  return reply.code;
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
  const host = hostNamed(flag('hook-protocol') ?? '') ?? DEFAULT_HOST;
  const raw = await Bun.stdin.text();
  const { call, cwd } = raw.trim() ? host.readPayload(raw) : {};
  if (call?.kind !== 'shell' || !cwd) {
    return 0;
  }
  const { shellGuard } = await import('@/hooks/guard');
  const refusal = shellGuard(call.command, cwd, FOLDERS.HOME, host.guard, { launch: host.launchDir() });
  return emit(host.guardReply(refusal || null));
};

export const runSessionStart = async (flag: Flag): Promise<number> => {
  const host = hostOf(flag);
  const { sessionStart } = await import('@/hooks/session-start');
  const isTerminal = host?.terminal() ?? false;
  const { rowDraws } = await import('@/notices/notices');
  const result = await sessionStart({ host, promptRow: isTerminal && rowDraws(), color: isTerminal });
  if (!host) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  return emit(host.sessionStartReply(result));
};

const sessionFromPayload = async (host: HostAdapter) => {
  const payload = host.readPayload(await Bun.stdin.text());
  return {
    transcriptPath: payload.transcriptPath ?? '',
    cwd: host.launchDir() ?? payload.cwd ?? '',
    sessionId: payload.sessionId ?? 'unknown'
  };
};

export const runSessionCapture = async (flag: Flag): Promise<number> => {
  const mode = flag('mode');
  if (mode !== 'session-end' && mode !== 'pre-compact') {
    throw new Error(
      `Usage: ${CLI_COMMAND} session-capture --mode=session-end|pre-compact [--hook-protocol=${HOST_NAMES.join('|')}] [--transcript=PATH --cwd=PATH --session-id=X] [--format=${HOST_NAMES.join('|')}]`
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
