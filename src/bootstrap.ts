/**
 * First import of the server entrypoint: hydrate the home's `.claude/settings*.json`
 * env before anything resolves the home or loads secrets. Claude Code injects that env
 * into its own sessions; Codex launches the server from the home's `.codex/config.toml`
 * registration with only the home variables set, so the server loads it itself. The
 * walk starts at the registered home when one is named, else at the cwd. A server started with
 * `--home-from-roots` (Antigravity runs a plugin's server in the plugin's folder) learns its home from the
 * client's MCP roots after it connects, and walks from there; walking from the plugin's folder would load
 * whatever settings sit above the checkout instead of the home's.
 */
import { resolveEnv } from '@/shared/naming';
import { expandTilde } from '@/shared/paths';
import { loadSettingsEnv } from '@/shared/settings-env';

const registeredHome = resolveEnv('AGENT_HOME');
if (registeredHome || !process.argv.includes('--home-from-roots')) {
  loadSettingsEnv(registeredHome ? expandTilde(registeredHome) : process.cwd());
}
