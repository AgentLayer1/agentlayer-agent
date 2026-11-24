import type { HookPayload, HostAdapter } from '@/hosts/contract';

interface ClaudePayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_input?: { command?: unknown };
}

/**
 * Some hook payloads carry Windows-style paths with unescaped backslashes; escape them and parse again.
 */
const parseLenient = (raw: string): ClaudePayload => {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/(?<!\\)\\(?!["\\])/g, '\\\\'));
  }
};

const readPayload = (raw: string): HookPayload => {
  const parsed = parseLenient(raw);
  const command = parsed.tool_input?.command;
  return {
    sessionId: parsed.session_id,
    transcriptPath: parsed.transcript_path,
    cwd: parsed.cwd,
    call: typeof command === 'string' ? { kind: 'shell', command } : { kind: 'other' }
  };
};

/**
 * Claude Code's hook protocol, which Codex speaks too: snake_case payloads, a refusal on stderr with exit 2, and a
 * session start reply in a `hookSpecificOutput` envelope.
 */
export const claudeProtocol = {
  readPayload,
  guardReply: (refusal) => (refusal === null ? { code: 0 } : { stderr: `${refusal}\n`, code: 2 }),
  sessionStartReply: (result) => ({
    stdout: JSON.stringify({
      systemMessage: result.systemMessage,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: result.additionalContext }
    }),
    code: result.error ? 1 : 0
  })
} satisfies Pick<HostAdapter, 'readPayload' | 'guardReply' | 'sessionStartReply'>;
