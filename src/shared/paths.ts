/**
 * Path helpers with no dependencies but the standard library.
 *
 * Deliberately a leaf: `config.ts`, `shared/env.ts`, and `shared/utils.ts` all need tilde
 * expansion, and every other home for it creates an import cycle (config imports env; utils
 * imports config). Three copies of the same three lines used to live in those files, and they
 * had already drifted — two handled `~/foo` but not a bare `~`.
 */
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Git Bash and Cygwin spell C:\Users as /c/Users or /cygdrive/c/Users; Windows path APIs need the drive form. */
export const driveForm = (path: string): string => path.replace(/^\/(?:cygdrive\/)?([a-z])(?:\/|$)/i, '$1:/');

/** A Windows path in Claude Code's rule form, `C:\Users\ada` → `/c/Users/ada`; other paths pass through. */
export const claudeForm = (path: string): string =>
  path.replace(/\\/g, '/').replace(/^([a-z]):(?=\/|$)/i, (_drive, letter: string) => `/${letter.toLowerCase()}`);

/** Whether two paths name the same file on `platform`: Windows ignores case and takes either separator. */
export const samePath = (a: string, b: string, platform: NodeJS.Platform = process.platform): boolean =>
  platform === 'win32' ? claudeForm(a).toLowerCase() === claudeForm(b).toLowerCase() : a === b;

/** Expand `~` or `~/foo` to an absolute path under the user's home. Other paths pass through. */
export const expandTilde = (path: string): string => {
  if (path === '~') {
    return homedir();
  }
  return path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path;
};

/** The file or folder a symlinked path points at (/tmp for /private/tmp); a path that doesn't exist stays as written. */
export const existingTarget = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** A path with its symlinks resolved through the longest part of it that exists and can be read. */
export const resolvedPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(resolvedPath(parent), basename(path));
  }
};

/** Whether `child` is `parent` or somewhere beneath it (lexical; resolve symlinks first when they matter). */
export const isInside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
