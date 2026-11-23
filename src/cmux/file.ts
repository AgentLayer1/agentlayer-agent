import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '@/shared/json-block';
import { compareSemver } from '@/upgrade/version';
import type { HomeEntry } from './sidebar/data';

export const SIDEBAR_NAME = 'agentlayer';

export const sidebarsDir = (): string => join(homedir(), '.config', 'cmux', 'sidebars');

export const sidebarFile = (dir: string, name = SIDEBAR_NAME): string => join(dir, `${name}.js`);

/**
 * The sidebar's code and the plugin version it was built by.
 */
export interface SidebarCode {
  version: string;
  bundle: string;
}

export interface SidebarParts extends SidebarCode {
  homes: Record<string, HomeEntry>;
}

const META = /^\/\* agentlayer sidebar · bundle (\S+) \*\/\n/;
// Up to the line feed, not `.`: JSON.stringify keeps U+2028 and U+2029, which `.` won't match.
const DATA = /^const DATA = ([^\n]*);\n/;

const parseHomes = (json: string): Record<string, HomeEntry> | null => {
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) && isRecord(parsed.homes)
      ? Object.fromEntries(
          Object.entries(parsed.homes).filter((pair): pair is [string, HomeEntry] => isRecord(pair[1]))
        )
      : null;
  } catch {
    return null;
  }
};

/**
 * Reads back a file `renderSidebar` wrote; anything else (hand-edited, truncated, another tool's) is `null`.
 */
export const parseSidebar = (text: string): SidebarParts | null => {
  const meta = META.exec(text);
  const rest = meta ? text.slice(meta[0].length) : '';
  const data = DATA.exec(rest);
  const homes = data?.[1] ? parseHomes(data[1]) : null;
  return meta?.[1] && data && homes ? { version: meta[1], homes, bundle: rest.slice(data[0].length) } : null;
};

export const renderSidebar = ({ version, homes, bundle }: SidebarParts): string =>
  `/* agentlayer sidebar · bundle ${version} */\nconst DATA = ${JSON.stringify({ homes })};\n${bundle}`;

/**
 * The installed homes with this one's entry put in (or taken out, for `null`), minus homes whose folder is gone.
 * Every home keeps its place whichever home writes; a new home joins last.
 */
export const mergeHomes = (
  current: SidebarParts | null,
  home: string,
  entry: HomeEntry | null,
  homeExists: (path: string) => boolean = existsSync
): Record<string, HomeEntry> => {
  // Spreading over a key already there keeps its position.
  const merged = Object.entries({ ...current?.homes, [home]: entry });
  return Object.fromEntries(
    merged.filter((pair): pair is [string, HomeEntry] => pair[1] !== null && (pair[0] === home || homeExists(pair[0])))
  );
};

/**
 * The newer of the installed code and this plugin's, so an older plugin's write never downgrades the sidebar.
 */
export const newerCode = (current: SidebarParts | null, own: SidebarCode): SidebarCode =>
  current && compareSemver(current.version, own.version) > 0 ? current : own;
