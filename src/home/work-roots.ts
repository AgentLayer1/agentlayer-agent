import { isRecord } from '@/shared/json-block';
import { expandTilde, isInside } from '@/shared/paths';
import { resolve } from 'node:path';

interface RootSettings {
  env?: unknown;
  permissions?: unknown;
}

const stringOf = (record: unknown, key: string): string => {
  const value = isRecord(record) ? record[key] : undefined;
  return typeof value === 'string' ? value : '';
};

const listOf = (record: unknown, key: string): string[] => {
  const value = isRecord(record) ? record[key] : undefined;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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
        ...listOf(settings.permissions, 'additionalDirectories'),
        ...['KNOWLEDGE', 'PROJECTS', 'REPORTS'].map((key) => stringOf(settings.env, `AGENT_${key}`))
      ]
        .map((path) => path.trim())
        .filter(Boolean)
        .map((path) => resolve(home, expandTilde(path)))
    )
  ].filter((path) => !isInside(path, home));
