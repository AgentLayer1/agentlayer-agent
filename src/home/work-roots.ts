import { isRecord, stringsOf } from '@/shared/json-block';
import { expandTilde, isInside, resolvedPath } from '@/shared/paths';
import { isAbsolute, resolve } from 'node:path';

interface RootSettings {
  env?: unknown;
  permissions?: unknown;
  sandbox?: unknown;
}

const stringOf = (record: unknown, key: string): string => {
  const value = isRecord(record) ? record[key] : undefined;
  return typeof value === 'string' ? value : '';
};

/**
 * The folders an agent works in outside its home, in the order its Claude settings name them: the code path, the git
 * repos, `additionalDirectories`, and the brain's folders when they live elsewhere.
 */
export const workRootsOf = (home: string, settings: RootSettings): string[] =>
  [
    ...new Set(
      [
        stringOf(settings.env, 'AGENT_CODE_PATH'),
        ...stringOf(settings.env, 'AGENT_GIT_REPOS').split(','),
        ...stringsOf(isRecord(settings.permissions) ? settings.permissions.additionalDirectories : undefined),
        ...['KNOWLEDGE', 'PROJECTS', 'REPORTS'].map((key) => stringOf(settings.env, `AGENT_${key}`))
      ]
        .map((path) => path.trim())
        .filter(Boolean)
        .map((path) => resolve(home, expandTilde(path)))
    )
    // Where a folder leads decides whether the home holds it: a link in the home to code outside it is still a root.
  ].filter((path) => !isInside(resolvedPath(path), resolvedPath(home)));

/** The folders the sandbox may write, as the settings' `sandbox.filesystem.allowWrite` names them: absolute, no globs. */
export const sandboxWritesOf = (settings: RootSettings): string[] => {
  const filesystem = isRecord(settings.sandbox) ? settings.sandbox.filesystem : undefined;
  return stringsOf(isRecord(filesystem) ? filesystem.allowWrite : undefined)
    .map(expandTilde)
    .filter((path) => isAbsolute(path) && !/[*?[\]{}]/.test(path));
};
