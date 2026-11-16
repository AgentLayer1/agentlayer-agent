/**
 * Pure task-prefix logic (no filesystem, no config) so it stays unit-testable
 * in isolation. The filesystem wiring lives in `scan.ts`.
 */

/** A task prefix as `assignPrefixes` hands it out: letters, then the number a collision adds (`hs`, `hs2`). */
const TASK_PREFIX = '[a-z]+\\d*';

/** A task file's name: its prefix (group 1), then its number. */
export const TASK_FILE = new RegExp(`^(${TASK_PREFIX})-\\d+`);

/** A task id written in prose (a note, a session log, a roadmap): a two-letter prefix and at least three digits. */
export const TASK_REF = '[a-z]{2}\\d*-\\d{3,}';

/**
 * Derive a project prefix from its slug — the fallback for a project with no
 * task files yet to infer from.
 *   - 2+ hyphen-separated parts: first letter of the first two (`agent-layer` → `al`)
 *   - single word: first two letters (`homestead` → `ho`)
 */
export const derivePrefix = (slug: string): string => {
  const parts = slug.toLowerCase().split('-').filter(Boolean);
  if (parts.length >= 2)
    return parts
      .slice(0, 2)
      .map((part) => part[0])
      .join('');
  return slug.slice(0, 2).toLowerCase();
};

/**
 * Assign a unique task prefix to each project. A prefix already inferred from
 * existing task files is authoritative — those task IDs live on disk under it —
 * so it claims its slot before any slug-derived prefix, which guarantees an
 * empty project can never displace a project whose IDs already exist. Remaining
 * collisions get a numeric suffix (`hs` → `hs2`). `onConflict` fires when two
 * authoritative prefixes collide — an on-disk conflict only a file rename fixes.
 */
export const assignPrefixes = (
  entries: ReadonlyArray<{ project: string; inferred: string | null }>,
  onConflict?: (prefix: string, project: string) => void
): Map<string, string> => {
  const map = new Map<string, string>();
  const used = new Set<string>();

  const claim = (project: string, desired: string): void => {
    let prefix = desired;
    if (used.has(prefix)) {
      let n = 2;
      while (used.has(`${prefix}${n}`)) n++;
      prefix = `${prefix}${n}`;
    }
    used.add(prefix);
    map.set(prefix, project);
  };

  for (const { project, inferred } of entries)
    if (inferred !== null) {
      if (used.has(inferred)) onConflict?.(inferred, project);
      claim(project, inferred);
    }
  for (const { project, inferred } of entries) if (inferred === null) claim(project, derivePrefix(project));

  return map;
};
