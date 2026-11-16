import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { FOLDERS, LAUNCHER } from '@/config';
import { log } from '@/shared/log';
import { pluginVersion } from '@/shared/naming';
import { writeFileAtomic } from '@/shared/utils';
import { cmuxTooOld, MIN_CMUX } from './app';
import { DIST } from './build';
import { homeEntry, type EntrySettings, type EntrySource } from './entry';
import {
  mergeHomes,
  newerCode,
  parseSidebar,
  renderSidebar,
  SIDEBAR_NAME,
  sidebarFile,
  sidebarsDir,
  type SidebarCode
} from './file';
import { CMUX_DATA, fixtureEntry, NOVA, SCOUT } from './preview/fixture';
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

export const entrySettings = (): EntrySettings => ({ launcher: LAUNCHER, projectsDir: FOLDERS.PROJECTS });

const readText = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

export type RefreshResult = 'not-installed' | 'not-joined' | 'unchanged' | 'written';

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
  const next = renderSidebar({
    ...newerCode(current, target.own()),
    homes: mergeHomes(current, home, entry, target.homeExists)
  });
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
    refreshSidebar(source.runtime.home, homeEntry(source, entrySettings()), target);
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
  const current = parseSidebar(readText(live));
  try {
    writeFileAtomic(
      staged,
      renderSidebar({ ...newerCode(current, target.own()), homes: mergeHomes(current, home, entry, target.homeExists) })
    );
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
  return cmux.run(['right-sidebar', 'set', 'custom', SIDEBAR_NAME])
    ? { ok: true, message: `${entry.name} is in the AgentLayer sidebar.` }
    : {
        ok: true,
        message: `${entry.name} is in the AgentLayer sidebar. Show it with: cmux right-sidebar set custom ${SIDEBAR_NAME}`
      };
};

export type RemoveResult = 'not-installed' | 'not-joined' | 'removed' | 'removed-file';

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

/**
 * The sidebar drawing the two invented homes and their invented sessions with a frozen clock, for screenshots.
 * Parameters shadow cmux's `data` and `cmux` globals, so it never shows real sessions and its taps go nowhere.
 */
export const previewText = (own: SidebarCode): string =>
  renderSidebar({
    version: own.version,
    homes: Object.fromEntries([NOVA, SCOUT].map((source) => [source.runtime.home, fixtureEntry(source)])),
    bundle: [
      `const MOCK = ${JSON.stringify(CMUX_DATA)};`,
      '((data, cmux) => {',
      own.bundle,
      '})({ workspaces: () => MOCK.workspaces, groups: () => undefined, clock: () => MOCK.clock }, () => {});',
      ''
    ].join('\n')
  });

export const previewSidebar = (path: string, own: SidebarCode): void => writeFileAtomic(path, previewText(own));
