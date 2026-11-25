import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { log } from '@/shared/log';
import { pluginVersion } from '@/shared/naming';
import { writeFileAtomic } from '@/shared/utils';
import { cmuxTooOld, MIN_CMUX } from './app';
import { DIST } from './build';
import { buildWork } from '@/work/build';
import type { Work } from '@/work/model';
import { homeEntry, readHomeState } from './entry';
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

type Absent = 'not-installed' | 'not-joined';

interface Installed {
  path: string;
  text: string;
  current: SidebarParts | null;
}

interface Joined extends Installed {
  current: SidebarParts;
}

// The sidebar file and what it parses to; `null` when there's no file.
const readInstalled = (target: SidebarTarget): Installed | null => {
  const path = sidebarFile(target.dir);
  if (!existsSync(path)) {
    return null;
  }
  const text = readFileSync(path, 'utf8');
  return { path, text, current: parseSidebar(text) };
};

// The installed sidebar when this home has joined it; why not, otherwise.
const readJoined = (home: string, target: SidebarTarget): Joined | Absent => {
  const installed = readInstalled(target);
  if (!installed) {
    return 'not-installed';
  }
  const { current } = installed;
  return current?.homes[home] ? { ...installed, current } : 'not-joined';
};

/** Whether this home is in the cmux sidebar, read only. */
export const sidebarState = (home: string, target: SidebarTarget = defaultTarget()): 'joined' | Absent => {
  const joined = readJoined(home, target);
  return typeof joined === 'string' ? joined : 'joined';
};

const writeIfChanged = (path: string, text: string, next: string): 'unchanged' | 'written' => {
  if (next === text) {
    return 'unchanged';
  }
  writeFileAtomic(path, next);
  return 'written';
};

export type RefreshResult = Absent | 'unchanged' | 'written';

/**
 * Puts this home's latest entry into the installed sidebar, but only when the file exists and the home joined it.
 */
export const refreshSidebar = (home: string, entry: HomeEntry, target: SidebarTarget): RefreshResult => {
  const joined = readJoined(home, target);
  if (typeof joined === 'string') {
    return joined;
  }
  return writeIfChanged(joined.path, joined.text, nextText(joined.current, home, entry, target));
};

/**
 * The dashboard's hook: refreshes this home's entry, and never fails the dashboard over it.
 */
export const refreshSidebarQuietly = (
  home: string,
  work: Work,
  target: SidebarTarget = defaultTarget()
): RefreshResult | 'failed' => {
  try {
    return refreshSidebar(home, homeEntry(home, work, readHomeState()), target);
  } catch (error) {
    log.with('cmux').warn(`sidebar refresh skipped: ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
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
  const current = readInstalled(target)?.current ?? null;
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

type RemoveResult = Absent | 'removed' | 'removed-file';

/**
 * Takes this home out of the sidebar; when it was the last home, the file goes too.
 */
export const removeSidebar = (home: string, target: SidebarTarget): RemoveResult => {
  const joined = readJoined(home, target);
  if (typeof joined === 'string') {
    return joined;
  }
  const { path, current } = joined;
  const homes = mergeHomes(current, home, null, target.homeExists);
  if (!Object.keys(homes).length) {
    rmSync(path, { force: true });
    return 'removed-file';
  }
  writeFileAtomic(path, renderSidebar({ ...current, homes }));
  return 'removed';
};

/**
 * Redraws this home in the installed sidebar after a proposal, a note or the heartbeat changed.
 */
export const redrawSidebar = (home: string): void => {
  // A fresh scan, not the saved model: a summary or task changed since the last dashboard rebuild would be undone.
  refreshSidebarQuietly(home, buildWork());
};
