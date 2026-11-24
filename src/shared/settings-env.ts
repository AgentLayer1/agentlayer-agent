import { ownDataDir } from '@/shared/naming';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Hydrate `process.env` from every `.claude/settings*.json` `env` block on the
 * ancestor path of `start` (nearest wins, `settings.local.json` over `settings.json`);
 * whatever is already in the environment always wins. Claude Code injects this env
 * into its own sessions; the CLI and a Codex-launched server load it themselves.
 * Side-effect-free at import on purpose: it must run before the home is resolved,
 * because a settings block may be what names the home.
 */
export function loadSettingsEnv(start: string): void {
  let dir = resolve(start);
  for (;;) {
    for (const file of ['settings.local.json', 'settings.json']) {
      const path = resolve(dir, '.claude', file);
      if (!existsSync(path)) continue;
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { env?: Record<string, unknown> };
        for (const [key, value] of Object.entries(parsed.env ?? {})) {
          if (typeof value === 'string') process.env[key] ??= value;
        }
      } catch {
        // a malformed settings file contributes nothing; the CLI's `ping` shows the resolved paths
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/** Pins the home a caller named on its own command line, ahead of anything a settings file says. */
export const pinHome = (home: string): void => {
  process.env.AGENT_HOME = home;
};

/** The nearest folder at or above `start` that is this agent's home, read from its marker alone. */
export const homeAbove = (start: string): string | undefined => {
  const dir = resolve(start);
  const parent = dirname(dir);
  return ownDataDir(dir) ? dir : parent === dir ? undefined : homeAbove(parent);
};

/** The home a hook payload's session works in: the first of its workspace folders, then its cwd, that sits in one. */
export const homeInPayload = (raw: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    const payload = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const folders = [...(Array.isArray(payload.workspacePaths) ? payload.workspacePaths : []), payload.cwd];
    return folders
      .filter((folder): folder is string => typeof folder === 'string' && folder !== '')
      .map(homeAbove)
      .find((home) => home !== undefined);
  } catch {
    return undefined;
  }
};
