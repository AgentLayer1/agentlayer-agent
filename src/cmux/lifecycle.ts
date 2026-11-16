import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { log } from '@/shared/log';
import { pluginVersion } from '@/shared/naming';
import { writeFileAtomic } from '@/shared/utils';
import { cmuxTooOld, MIN_CMUX } from './app';
import { DIST } from './build';
import { homeEntry, type EntrySource } from './entry';
import {
  mergeHomes,
  newerCode,
  parseSidebar,
  renderSidebar,
  SIDEBAR_NAME,
  sidebarFile,
  sidebarsDir,
  type SidebarCode,
  type SidebarParts
} from './file';
import type { HomeEntry } from './sidebar/data';

/**
 * Where the sidebar lives and the code this plugin would write into it (read only when a write needs it).
 */
export interface SidebarTarget {
  dir: string;
  own: () => SidebarCode;
  homeExists?: (path: string) => boolean;
}

export interface CmuxHost {
  version: string | null;
  run: (args: string[]) => boolean;
}

export const defaultTarget = (): SidebarTarget => ({
  dir: sidebarsDir(),
  own: () => ({ version: pluginVersion(), bundle: readFileSync(DIST, 'utf8') })
});

const nextText = (current: SidebarParts | null, home: string, entry: HomeEntry, target: SidebarTarget): string =>
  renderSidebar({ ...newerCode(current, target.own()), homes: mergeHomes(current, home, entry, target.homeExists) });

type RefreshResult = 'not-installed' | 'not-joined' | 'unchanged' | 'written';

/**
 * Puts this home's latest entry into the installed sidebar, but only when the file exists and the home joined it.
 */
export const refreshSidebar = (home: string, entry: HomeEntry, target: SidebarTarget): RefreshResult => {
  const path = sidebarFile(target.dir);
  if (!existsSync(path)) {
    return 'not-installed';
  }
  const text = readFileSync(path, 'utf8');
  const current = parseSidebar(text);
  if (!current?.homes[home]) {
    return 'not-joined';
  }
  const next = nextText(current, home, entry, target);
  if (next === text) {
    return 'unchanged';
  }
  writeFileAtomic(path, next);
  return 'written';
};

/**
 * The dashboard's hook: refreshes this home's entry, and never fails the dashboard over it.
 */
export const refreshSidebarQuietly = (source: EntrySource, target: SidebarTarget = defaultTarget()): void => {
  try {
    refreshSidebar(source.runtime.home, homeEntry(source), target);
  } catch (error) {
    log.with('cmux').warn(`sidebar refresh skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export interface InstallResult {
  ok: boolean;
  message: string;
}

const STAGED = `${SIDEBAR_NAME}-next`;

/**
 * Adds this home to the sidebar (starting the file if it's the first), checked by cmux under a staging name first,
 * so a file cmux rejects never replaces the installed one; then selects it in the right sidebar.
 */
export const installSidebar = (
  home: string,
  entry: HomeEntry,
  target: SidebarTarget,
  cmux: CmuxHost
): InstallResult => {
  if (!cmux.version) {
    return {
      ok: false,
      message: 'cmux isn’t installed in /Applications. Get it from https://cmux.com, then run this again.'
    };
  }
  if (cmuxTooOld(cmux.version)) {
    return {
      ok: false,
      message: `cmux ${cmux.version} is too old for the sidebar: update it to ${MIN_CMUX} or later.`
    };
  }
  const live = sidebarFile(target.dir);
  const staged = sidebarFile(target.dir, STAGED);
  const current = parseSidebar(existsSync(live) ? readFileSync(live, 'utf8') : '');
  try {
    writeFileAtomic(staged, nextText(current, home, entry, target));
    if (!cmux.run(['sidebar', 'validate', STAGED])) {
      return {
        ok: false,
        message:
          'cmux didn’t accept the sidebar. Run this from a terminal inside cmux; the installed sidebar is unchanged.'
      };
    }
    renameSync(staged, live);
  } finally {
    rmSync(staged, { force: true });
  }
  const shown = cmux.run(['right-sidebar', 'set', 'custom', SIDEBAR_NAME]);
  const hint = shown ? '' : ` Show it with: cmux right-sidebar set custom ${SIDEBAR_NAME}`;
  return { ok: true, message: `${entry.name} is in the AgentLayer sidebar.${hint}` };
};

type RemoveResult = 'not-installed' | 'not-joined' | 'removed' | 'removed-file';

/**
 * Takes this home out of the sidebar; when it was the last home, the file goes too.
 */
export const removeSidebar = (home: string, target: SidebarTarget): RemoveResult => {
  const path = sidebarFile(target.dir);
  if (!existsSync(path)) {
    return 'not-installed';
  }
  const current = parseSidebar(readFileSync(path, 'utf8'));
  if (!current?.homes[home]) {
    return 'not-joined';
  }
  const homes = mergeHomes(current, home, null, target.homeExists);
  if (!Object.keys(homes).length) {
    rmSync(path, { force: true });
    return 'removed-file';
  }
  writeFileAtomic(path, renderSidebar({ ...current, homes }));
  return 'removed';
};
