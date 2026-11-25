#!/usr/bin/env bun
/**
 * The plugin MCP server — entrypoint.
 * stdio transport; spawned by Claude Code from the plugin manifest, by Codex from the
 * home's `.codex/config.toml` registration (see `skills/init/scripts/codex-setup.ts`).
 *
 * Boot is side-effect-free. Tools that write (compile state, OAuth tokens,
 * playwright captures) create their parent dirs at write time. Pre-init
 * plugins must not touch disk.
 */
import '@/bootstrap';
import { AGENT_SLUG, FILES, FOLDERS, isInitialized, MCP_PREFIX, PLUGIN_NAME } from '@/config';
import { useHomeInRoots } from '@/home/roots';
import { asks, readMergedSettings } from '@/home/settings-scope';
import { withCallSignal } from '@/shared/call-signal';
import { log } from '@/shared/log';
import { RUNTIME_DIR } from '@/shared/naming';
import { existsSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { TOOLS } from '@/tools';
import { z } from 'zod';

const server = new McpServer({ name: AGENT_SLUG, version: '0.1.0' });

/**
 * Tools that run without an agent home, mirroring the CLI's exemptions.
 *
 * `ping` is a diagnostic — it has to answer, and answering includes saying the
 * home isn't one. The worktree verbs act on the repo path they're handed and
 * touch no home state (no `FOLDERS.*` in that module at all).
 *
 * Everything else is gated. Nearly every other tool reads or writes under the
 * home, and several — `video_frames` and the browser captures via
 * `.<data-dir>/browser`, OAuth tokens via `.<data-dir>/secrets` — would create
 * the data dir there, which is the marker that decides what counts as this
 * agent's home. Scaffolding it into the wrong tree makes that tree permanently
 * look like a home.
 */
const HOMELESS_OK = new Set(['ping', 'setup_worktree', 'list_worktrees', 'remove_worktree']);

/** Resolved once the client's roots have been read, or at once when the home came from the environment. */
const ROOTS_WAIT_MS = 5_000;
const fromRoots = process.argv.includes('--home-from-roots');
const rootsRead = (() => {
  if (!fromRoots) {
    return Promise.resolve();
  }
  const first = new Promise<void>((done) => {
    server.server.oninitialized = () => {
      (async (): Promise<void> => {
        if (!server.server.getClientCapabilities()?.roots) {
          return;
        }
        const { roots } = await server.server.listRoots();
        const found = useHomeInRoots(roots.map((root) => root.uri));
        log.info(found ? `home from MCP roots: ${FOLDERS.HOME}` : 'no MCP root is an agent home');
      })()
        .catch((err: unknown) => log.warn(`roots/list failed: ${String(err)}`))
        .finally(done);
    };
  });
  return Promise.race([first, Bun.sleep(ROOTS_WAIT_MS)]);
})();

for (const tool of TOOLS) {
  const toolLog = log.with(() => `tool:${tool.name}`);
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: z.object(tool.inputSchema), _meta: tool.meta },
    async (args, ctx) => {
      toolLog.debug('dispatch', args);
      try {
        await rootsRead;
        if (!HOMELESS_OK.has(tool.name) && !isInitialized()) {
          toolLog.warn(`refused — ${FOLDERS.HOME} is not this agent's home`);
          return {
            content: [
              {
                type: 'text' as const,
                // Never suggest init when a SOUL.md is sitting there: that's a
                // scaffolded brain whose data dir is missing, or another agent's
                // home, and init's re-run path offers to overwrite exactly those
                // identity files. Same distinction SessionStart draws.
                text: existsSync(FILES.SOUL)
                  ? `Error: ${tool.name} needs an agent home. ${FOLDERS.HOME} has a SOUL.md but no ` +
                    `${RUNTIME_DIR}/version.json recording ${PLUGIN_NAME}, so it ` +
                    `is either another agent's home or this one's data-dir state is missing after a restore. ` +
                    `Do NOT run init to repair it — that would offer to overwrite the identity files already ` +
                    `there. Restore those files from the backup or the brain repo (both are git-tracked), ` +
                    `or relaunch from the right home.`
                  : `Error: ${tool.name} needs an agent home, and ${FOLDERS.HOME} is not one ` +
                    `(no ${RUNTIME_DIR}/version.json recording ${PLUGIN_NAME} there). The home is resolved from the directory ` +
                    `this session was launched in, so start Claude Code from the agent home — or run ` +
                    `/${PLUGIN_NAME}:init there if it hasn't been set up yet.`
              }
            ],
            isError: true
          };
        }
        const rule = `${MCP_PREFIX}${tool.name}`;
        if (tool.askOnly && !asks(readMergedSettings(FOLDERS.HOME).merged, rule)) {
          throw new Error(
            `${tool.name} runs only behind an approval prompt, and this home's settings don't have one. Run /${PLUGIN_NAME}:upgrade (it adds "${rule}" to permissions.ask in .claude/settings.json), then try again.`
          );
        }
        const result = await withCallSignal(ctx.mcpReq.signal, () => tool.handler(args));
        return {
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolLog.error(`failed: ${message}`);
        return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
      }
    }
  );
}

await server.connect(new StdioServerTransport());
log.info(`${AGENT_SLUG} MCP server started — tools=${TOOLS.length}`);
