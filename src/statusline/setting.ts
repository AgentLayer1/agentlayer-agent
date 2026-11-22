/**
 * The `statusLine` entry a home's Claude settings carry, and the check that its command still
 * names the plugin that is running. Claude Code offers no plugin-level status line and no
 * `${CLAUDE_PLUGIN_ROOT}` in settings, so the command pins the checkout; a version-pinned
 * plugin cache moves on every release, and a stale path leaves the footer blank with nothing
 * on screen saying why.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { existingTarget } from '../shared/paths';

export interface StatusLineSetting {
  type: 'command';
  command: string;
}

/** Double quotes are the one quoting sh and PowerShell agree on; a path either shell would expand inside them is refused. */
const quote = (value: string): string => {
  if (/["$`]/.test(value)) {
    throw new Error(`${value}: the status line command may not contain ", $, or a backtick`);
  }
  return `"${value}"`;
};

/** Forward slashes on every platform: Git Bash on Windows eats the backslashes in a settings command. */
export const statusLineSetting = (cliPath: string): StatusLineSetting => ({
  type: 'command',
  command: `bun ${quote(cliPath.replaceAll('\\', '/'))} statusline`
});

/** The path a command of ours points at, when it is ours (`bun "<root>/src/cli.ts" statusline`). */
export const commandCliPath = (command: string): string | undefined =>
  /^bun "?(.+?[\\/]src[\\/]cli\.ts)"? statusline(?:\s|$)/.exec(command.trim())?.[1];

/** Symlink-free, so a checkout reached through a link never reads as a different plugin. */
const canonical = (path: string): string => existingTarget(resolve(path));

const commandIn = (path: string): unknown => {
  try {
    return (JSON.parse(readFileSync(path, 'utf-8')) as { statusLine?: { command?: unknown } } | null)?.statusLine
      ?.command;
  } catch {
    return undefined; // a settings file Claude Code itself could not parse is not this check's problem
  }
};

/**
 * Why the home's status line will not render from this checkout, or nothing when it is
 * absent, the operator's own, or already current. The local file wins, as it does in Claude Code.
 */
export const statusLineDrift = (
  claudeDir: string,
  cliPath: string,
  skill: (name: string) => string
): string | undefined => {
  const source = ['settings.local.json', 'settings.json']
    .map((name) => ({
      name,
      command: existsSync(join(claudeDir, name)) ? commandIn(join(claudeDir, name)) : undefined
    }))
    .find(({ command }) => command !== undefined);
  if (!source || typeof source.command !== 'string') return undefined;
  const pinned = commandCliPath(source.command);
  if (pinned === undefined || canonical(pinned) === canonical(cliPath)) return undefined;
  return `\`.claude/${source.name}\` runs the status line from \`${pinned}\`, not this plugin (\`${resolve(cliPath)}\`), so the footer stays blank — run \`${skill('upgrade')}\` to re-point it`;
};
