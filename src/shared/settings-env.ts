import { ownDataDir } from '@/shared/naming';
import { resolvedPath } from '@/shared/paths';
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

/** The nearest folder at or above `start` that is this agent's home, read from its marker alone; through a symlink, the home above where it leads. */
export const homeAbove = (start: string): string | undefined => {
  const walk = (dir: string): string | undefined => {
    const parent = dirname(dir);
    return ownDataDir(dir) ? dir : parent === dir ? undefined : walk(parent);
  };
  return walk(resolve(start)) ?? walk(resolvedPath(resolve(start)));
};

/** The home a session works in: the first of its workspace folders, then its folder, that sits in one. */
export const homeOfSession = (session: { workspacePaths?: unknown; cwd?: unknown }): string | undefined =>
  [...(Array.isArray(session.workspacePaths) ? session.workspacePaths : []), session.cwd]
    .filter((folder): folder is string => typeof folder === 'string' && folder !== '')
    .reduce<string | undefined>((found, folder) => found ?? homeAbove(folder), undefined);

/** The home a raw hook payload's session works in, or undefined when it doesn't parse. */
export const homeInPayload = (raw: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? homeOfSession(parsed) : undefined;
  } catch {
    return undefined;
  }
};
