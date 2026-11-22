import { readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, dirname, extname, join, sep } from 'node:path';
import { FOLDERS, TIMEZONE } from '@/config';
import { documentTitle } from '@/reports/read';
import { DAY_MS } from '@/shared/date';
import { extractTitleTag } from '@/shared/html-to-markdown';
import { readTextIfExists } from '@/shared/text';

// Keeps the sidebar file every home shares small.
export const RECENT_LIMIT = 40;

const WINDOW_MS = 30 * DAY_MS;

const EXTENSIONS = new Set(['.md', '.html', '.pdf', '.csv', '.txt', '.png', '.jpg']);

const ROOT_FILES = new Set(['USER.md', 'SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'roadmap.html']);

const TOP_FOLDERS = new Set(['projects', 'reports', 'knowledge', 'extensions']);

// Rewritten by the plugin on every change, so they'd always lead the list.
const GENERATED = new Set([join('projects', 'TASKS.md'), join('reports', 'index.md'), join('reports', 'pinned.md')]);

// Folders no recent file can sit under, skipped without reading them.
const SKIPPED = new Set([join('knowledge', 'raw'), join('knowledge', 'memory', 'archive'), join('reports', 'captures')]);

const DAILY_MEMORY = /^\d{4}-\d{2}-\d{2}\.md$/;

/**
 * A file in the home that changed lately, as the sidebar's Recent lists it.
 */
export interface RecentFile {
  /**
   * HOME-relative; the page when a note and its page share a name.
   */
  path: string;
  /**
   * When it last changed, in the home's timezone: `YYYY-MM-DD` and `HH:MM`.
   */
  date: string;
  time: string;
  title: string;
}

interface Changed {
  path: string;
  mtimeMs: number;
}

const isHidden = (name: string): boolean => name.startsWith('.') || name === 'node_modules';

/**
 * Whether a HOME-relative file belongs in Recent: the operator's documents, not the plugin's state, raw inputs or
 * generated pages.
 */
export const isRecentPath = (path: string): boolean => {
  const parts = path.split(sep);
  const [top = '', second = '', third = ''] = parts;
  if (parts.some(isHidden) || !EXTENSIONS.has(extname(path)) || GENERATED.has(path)) {
    return false;
  }
  if (parts.length === 1) {
    return ROOT_FILES.has(path);
  }
  if (top === 'projects') {
    return true;
  }
  if (top === 'reports') {
    return parts.length > 2 && second !== 'captures';
  }
  if (top === 'knowledge') {
    return (
      parts.length === 3 &&
      (second === 'user' ||
        second === 'concepts' ||
        (second === 'memory' && (third === 'index.md' || DAILY_MEMORY.test(third))))
    );
  }
  return top === 'extensions' && second === 'skills' && parts.length === 3 && extname(path) === '.md';
};

/**
 * Where a Recent file sits: its kind by folder, and the project it belongs to ('' outside projects/).
 */
export const recentPlace = (path: string): { kind: string; project: string } => {
  const [top = '', second = '', third = ''] = path.split(sep);
  const project = top === 'projects' ? second : '';
  if (basename(path) === 'roadmap.html') {
    return { kind: 'roadmap', project };
  }
  if (top === 'projects') {
    return { kind: third === 'tasks' ? 'task' : extname(path) === '.html' ? 'page' : 'doc', project };
  }
  if (top === 'reports') {
    return { kind: second, project };
  }
  if (top === 'knowledge') {
    return { kind: second === 'memory' ? 'memory' : 'knowledge', project };
  }
  return { kind: top === 'extensions' ? 'extension' : 'identity', project };
};

const entriesOf = (folder: string): Dirent[] => {
  try {
    return readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
};

const entersFolder = (path: string): boolean =>
  !isHidden(basename(path)) && !SKIPPED.has(path) && (dirname(path) !== '.' || TOP_FOLDERS.has(path));

const walk = (home: string, folder: string): Changed[] =>
  entriesOf(join(home, folder)).flatMap((entry) => {
    const path = folder ? join(folder, entry.name) : entry.name;
    if (entry.isDirectory()) {
      return entersFolder(path) ? walk(home, path) : [];
    }
    return entry.isFile() && isRecentPath(path) ? [{ path, mtimeMs: statSync(join(home, path)).mtimeMs }] : [];
  });

/**
 * A path without its extension, which a note and its page share.
 */
export const stemOf = (path: string): string => join(dirname(path), basename(path, extname(path)));

const isPaired = (path: string): boolean => ['.md', '.html'].includes(extname(path));

// A note and its page are one row: the page opens, and the newer of the two dates it.
const pairNotes = (files: readonly Changed[]): Changed[] => {
  const groups = Map.groupBy(files, (file) => (isPaired(file.path) ? stemOf(file.path) : file.path));
  return [...groups.values()].flatMap((group) => {
    const shown = group.find((file) => extname(file.path) === '.html') ?? group[0];
    return shown ? [{ path: shown.path, mtimeMs: Math.max(...group.map((file) => file.mtimeMs)) }] : [];
  });
};

// A note and its page share one title: the note's own, else the page's, else their name.
const titleOf = (home: string, path: string): string => {
  if (!isPaired(path)) {
    return basename(path);
  }
  const stem = stemOf(path);
  const name = basename(stem);
  const noted = documentTitle(readTextIfExists(join(home, `${stem}.md`)), `${name}.md`);
  if (noted !== name || extname(path) !== '.html') {
    return noted;
  }
  return extractTitleTag(readTextIfExists(join(home, path))) ?? name;
};

/**
 * The newest files the operator would want back, newest first: at most RECENT_LIMIT changed in the last 30 days.
 */
export const readRecentFiles = (home: string = FOLDERS.HOME, now: number = Date.now()): RecentFile[] => {
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE, dateStyle: 'short', timeStyle: 'short' });
  return pairNotes(walk(home, ''))
    .filter((file) => now - file.mtimeMs <= WINDOW_MS)
    .toSorted((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
    .slice(0, RECENT_LIMIT)
    .map(({ path, mtimeMs }) => {
      const stamp = format.format(mtimeMs);
      return { path, date: stamp.slice(0, 10), time: stamp.slice(11, 16), title: titleOf(home, path) };
    });
};
