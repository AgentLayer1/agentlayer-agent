#!/usr/bin/env bun
/**
 * Bytes the agent home loads into every session, per host: Claude Code reads the bridge, what it
 * `@`-imports (recursively, prose only, never inside code), and the unscoped rule files; Codex
 * reads AGENTS.md natively and gets the identity stack from the SessionStart hook. An import that
 * does not resolve is listed and fails the run, so a partial total is never mistaken for a
 * baseline. Read-only.
 *
 * Usage: context-weight.ts [--home <dir>]   (else the agent's home variable, else the cwd)
 */
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const homeFlag = args.indexOf('--home') === -1 ? undefined : args[args.indexOf('--home') + 1];
// The config module resolves the home from AGENT_HOME, so an explicit --home is exported before it loads.
if (homeFlag) process.env.AGENT_HOME = resolve(homeFlag);
const { FOLDERS } = await import('../../../src/config');
const { agentHomePath, isAgentHome } = await import('../../../src/shared/env');
const { importedStack, injectedStack } = await import('../../../src/hooks/weight');

const home = agentHomePath();
if (!isAgentHome(home)) {
  console.error(`not an agent home: ${home}`);
  process.exit(2);
}

const claude = importedStack();
// The Codex hook skips a static file that is missing, so an absent one is reported, not an error.
const codex = injectedStack();
process.stdout.write(`${JSON.stringify({ home: FOLDERS.HOME, claude, codex }, null, 2)}\n`);
if (claude.unresolved.length > 0) process.exit(1);
