/**
 * The home's own tools: `ping` (is this a home), `home_history` (an MCP wrapper around
 * @/home/history) and `codex_setup` (the home's Codex wiring). The last two run outside the
 * Bash sandbox, which refuses to create `.git` at the working-directory root and, in a Codex
 * session, keeps the workspace's `.codex/` read-only. `home_history` writes the home's
 * `settings.local.json` grants itself so the merge is deterministic; the `history` skill owns
 * the conversation. The Codex generator lives at `skills/init/scripts/codex-setup.ts`, and init
 * and upgrade delegate to `codex_setup` for that reason.
 */
import { FOLDERS, PLUGIN_VERSION, TIMEZONE, isInitialized } from '@/config';
import { historyStatus, restorePointer, setupHistory } from '@/home/history';
import { runGroup } from '@/shared/process-group';
import { defineTool, type ToolDef } from '@/shared/tool-def';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const SCRIPT_TIMEOUT_MS = 60_000;

interface SetupResult {
  ok: boolean;
  exitCode: number;
  report?: unknown;
  stderr?: string;
  message: string;
}

export const runCodexSetup = async (): Promise<SetupResult> => {
  const script = resolve(FOLDERS.ROOT, 'skills', 'init', 'scripts', 'codex-setup.ts');
  const proc = await runGroup(
    [process.execPath, script, '--home', FOLDERS.HOME, '--plugin-root', FOLDERS.ROOT, '--write'],
    {
      cwd: FOLDERS.HOME,
      // No cancel: the generator writes several files, and stopped halfway it would leave them out of step.
      timeoutMs: SCRIPT_TIMEOUT_MS
    }
  );
  const exitCode = proc.stopped ? -1 : (proc.exitCode ?? -1);
  const stdout = proc.stdout.trim();
  let report: unknown;
  try {
    report = stdout ? JSON.parse(stdout.split('\n').at(-1) ?? '') : undefined;
  } catch {
    report = undefined;
  }
  return {
    ok: exitCode === 0,
    exitCode,
    report,
    stderr: proc.stderr.slice(-2000),
    message:
      exitCode === 0
        ? 'Codex wiring written.'
        : proc.stopped
          ? `Codex wiring timed out after ${SCRIPT_TIMEOUT_MS / 1_000} s and may be half-written; run codex_setup again.`
          : `Codex wiring failed (exit ${exitCode}); nothing was changed.`
  };
};

const codexWired = (): boolean => existsSync(join(FOLDERS.HOME, '.codex', 'config.toml'));

export const tools: ToolDef[] = [
  defineTool({
    name: 'ping',
    description:
      'Health check — returns server status, the plugin version this server process loaded, and resolved paths.',
    inputSchema: {},
    // `ok` reports whether the resolved path is actually this agent's home,
    // which is what decides if every other tool will run. A hardcoded `true`
    // made the one diagnostic that exists to catch a misresolved home the one
    // thing that couldn't.
    handler: async () => ({
      ok: isInitialized(),
      // The version in memory, not on disk: after a code update the two differ until the
      // host restarts, and callers that spawn plugin scripts need to know which they have.
      version: PLUGIN_VERSION,
      time: new Date().toISOString(),
      timezone: TIMEZONE,
      paths: {
        home: FOLDERS.HOME,
        knowledge: FOLDERS.KNOWLEDGE,
        projects: FOLDERS.PROJECTS,
        data: FOLDERS.DATA
      }
    })
  }),
  defineTool({
    name: 'home_history',
    description:
      "Version history for this agent home. `status` reports on/off, where it's kept, the last snapshot, and, for a synced home, the local folder setup will use; its only write puts back a .git link a synced folder deleted (`restored`). `setup` turns it on (in place, or kept outside a cloud-synced folder with its path and sandbox grants recorded in .claude/settings.local.json) and makes the first snapshot; idempotent. When it records new grants on a home wired for Codex, it regenerates the Codex wiring too and returns that report as `codex`. A home whose version history is set up some other way is left alone. Runs outside the Bash sandbox.",
    inputSchema: {
      action: z.enum(['status', 'setup']),
      name: z.string().optional().describe("setup: the operator's name, used only when this machine has no git identity."),
      startOver: z
        .boolean()
        .optional()
        .describe('setup: when the saved history is gone (history-missing), start a new one; only after the operator agreed.')
    },
    handler: async ({ action, name, startOver }) => {
      if (action === 'setup') {
        const result = setupHistory(FOLDERS.HOME, { name, startOver });
        const wired = codexWired();
        // Codex derives its writable roots from the grants setup just wrote, so a stale profile can't reach the history folder.
        return { ...result, codexWired: wired, ...(wired && result.settingsChanged ? { codex: await runCodexSetup() } : {}) };
      }
      const restored = restorePointer(FOLDERS.HOME);
      return { ...historyStatus(FOLDERS.HOME), restored, codexWired: codexWired() };
    }
  }),
  defineTool({
    name: 'codex_setup',
    description:
      "Generate or regenerate this home's Codex wiring (.codex/hooks.json, the MCP registration and permission profile in .codex/config.toml, and .codex/rules/agentlayer.rules) from the plugin checkout, the home's Claude settings, and the pack servers in its .mcp.json (the Xcode pack's xcode). Runs outside the Bash sandbox, which is what lets it write .codex/ from a Codex session. Called by init, upgrade, and the pack walks; returns the generator's report, whose hooks.changed means the operator must re-trust the hook entries in /hooks.",
    inputSchema: {},
    handler: async (): Promise<SetupResult> => runCodexSetup()
  })
];
