/**
 * The hook verbs behind the CLI (`guard`, `policy`, `session-start`, `session-capture`): each reads the
 * host's payload, calls its core, and writes the reply the host's hook protocol expects. Each
 * returns the process exit code.
 */
import { FOLDERS, isInitialized } from '@/config';
import { hookStdin } from '@/hooks/stdin';
import { HOST_NAMES, isHostName, type HookPayload, type HookReply, type HostAdapter } from '@/hosts/contract';
import { DEFAULT_HOST, hostNamed } from '@/hosts/registry';
import { CLI_COMMAND } from '@/shared/naming';
import { pinHome } from '@/shared/settings-env';

type Flag = (name: string) => string | undefined;

/** The hook payload on stdin, or undefined when there is none or it can't be read. */
const payloadOf = async (host: HostAdapter): Promise<HookPayload | undefined> => {
  const raw = await hookStdin();
  try {
    return raw.trim() ? host.readPayload(raw) : undefined;
  } catch {
    return undefined;
  }
};

/** For a host whose hooks run outside the home: pin the payload's home, or report that the session works in none. */
const atHome = (host: HostAdapter, payload: HookPayload | undefined): boolean => {
  if (!host.homeFromPayload) {
    return true;
  }
  if (!payload?.home) {
    return false;
  }
  pinHome(payload.home);
  return true;
};

/** A host with no session-end event keeps each of its conversations on the open list for the drain. */
const recordFor = async (host: HostAdapter, payload: HookPayload | undefined): Promise<void> => {
  if (host.recordsConversations && payload?.origin === 'user') {
    const { recordConversation } = await import('@/knowledge/session-capture');
    await recordConversation(payload, host.name);
  }
};

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
  const raw = await hookStdin();
  const { call, cwd } = raw.trim() ? host.readPayload(raw) : {};
  if (call?.kind !== 'shell' || !cwd) {
    return 0;
  }
  const { shellGuard } = await import('@/hooks/guard');
  const refusal = shellGuard(call.command, cwd, FOLDERS.HOME, host.guard, { launch: host.launchDir() });
  return emit(host.guardReply(refusal || null));
};

/**
 * A host's policy hook on every tool call: the shell guard, then the home's rules. Its own failure refuses the call
 * with its reason, since a policy that can't be read can't let anything through.
 */
export const runPolicy = async (flag: Flag): Promise<number> => {
  const host = hostOf(flag);
  const reply = host?.policyReply;
  if (!host || !reply) {
    return 0;
  }
  const payload = await payloadOf(host);
  if (!payload || !atHome(host, payload) || !isInitialized()) {
    return 0;
  }
  try {
    const { call } = payload;
    const cwd = payload.cwd ?? FOLDERS.HOME;
    if (call.kind === 'shell') {
      const { shellGuard } = await import('@/hooks/guard');
      const refusal = shellGuard(call.command, cwd, FOLDERS.HOME, host.guard, { launch: host.launchDir() });
      if (refusal) {
        return emit(reply({ decision: 'deny', reason: refusal }));
      }
    }
    const { effectiveSettings, policyDecision } = await import('@/hooks/policy');
    return emit(reply(policyDecision(call, { home: FOLDERS.HOME, cwd, settings: effectiveSettings(FOLDERS.HOME) })));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return emit(
      reply({
        decision: 'deny',
        reason: `The agent's policy check failed, so every call is refused until it is fixed: ${reason}`
      })
    );
  }
};

export const runSessionStart = async (flag: Flag): Promise<number> => {
  const host = hostOf(flag);
  const payload = host ? await payloadOf(host) : undefined;
  if ((host && !atHome(host, payload)) || payload?.origin === 'child') {
    return 0;
  }
  if (host) {
    await recordFor(host, payload);
  }
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
  const payload = await payloadOf(host);
  if (!payload || !atHome(host, payload)) {
    return undefined;
  }
  await recordFor(host, payload);
  return {
    origin: payload.origin,
    transcriptPath: payload.transcriptPath ?? '',
    cwd: host.launchDir() ?? payload.cwd ?? '',
    sessionId: payload.sessionId ?? 'unknown'
  };
};

export const runSessionCapture = async (flag: Flag): Promise<number> => {
  const mode = flag('mode');
  if (mode !== 'session-end' && mode !== 'pre-compact' && mode !== 'turn-end') {
    throw new Error(
      `Usage: ${CLI_COMMAND} session-capture --mode=session-end|pre-compact|turn-end [--hook-protocol=${HOST_NAMES.join('|')}] [--transcript=PATH --cwd=PATH --session-id=X] [--format=${HOST_NAMES.join('|')}]`
    );
  }
  const host = hostOf(flag);
  const fromPayload = host ? await sessionFromPayload(host) : undefined;
  if (host && !fromPayload) {
    return 0;
  }
  const { origin, ...session } = fromPayload
    ? fromPayload
    : {
        origin: 'user',
        transcriptPath: flag('transcript') ?? '',
        cwd: flag('cwd') ?? process.cwd(),
        sessionId: flag('session-id') ?? 'cli'
      };
  if (origin === 'child') {
    return 0;
  }
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
