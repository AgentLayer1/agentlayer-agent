import { readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { FOLDERS, TIMEZONE } from '@/config';
import { documentTitle } from '@/reports/read';
import { DAY_MS } from '@/shared/date';
import { extractTitleTag } from '@/shared/html-to-markdown';
import { readTextIfExists } from '@/shared/text';

// Keeps the sidebar file every home shares small.
export const RECENT_LIMIT = 40;

const WINDOW_MS = 30 * DAY_MS;

const EXTENSIONS = new Set(['.md', '.html', '.pdf', '.csv', '.txt', '.png', '.jpg']);

const IDENTITY_FILES = new Set(['USER.md', 'SOUL.md', 'IDENTITY.md', 'AGENTS.md']);

const DAILY_MEMORY = /^\d{4}-\d{2}-\d{2}\.md$/;

/**
 * A file in the home that changed lately, as the sidebar's Recent lists it.
 */
export interface RecentFile {
  /**
   * HOME-relative (`../` for a folder kept outside the home); the page when a note and its page share a name.
   */
  path: string;
  /**
   * What sort of file it is by where it sits (`task`, `roadmap`, a report's folder, `knowledge`).
   */
  kind: string;
  /**
   * The slug of the project it sits in, '' when none.
   */
  project: string;
  /**
   * When it last changed, in the home's timezone: `YYYY-MM-DD` and `HH:MM`.
   */
  date: string;
  time: string;
  title: string;
}

/**
 * Where the home keeps each part of itself; projects, reports and knowledge can each live outside it.
 */
export interface HomeFolders {
  home: string;
  projects: string;
  reports: string;
  knowledge: string;
}

const homeFolders = (): HomeFolders => ({
  home: FOLDERS.HOME,
  projects: FOLDERS.PROJECTS,
  reports: FOLDERS.REPORTS,
  knowledge: FOLDERS.KNOWLEDGE
});

interface Place {
  kind: string;
  project: string;
}

/**
 * A part of the home Recent looks in: a folder, which subfolders it walks (none without `enters`), which files count,
 * and what each one is. `parts` is a path below the zone's folder.
 */
interface Zone {
  folder: string;
  enters?: (parts: readonly string[]) => boolean;
  keeps: (parts: readonly string[]) => boolean;
  place: (parts: readonly string[]) => Place;
}

const everything = (): boolean => true;

const kindOnly = (kind: string) => (): Place => ({ kind, project: '' });

const projectPlace = (parts: readonly string[]): Place => {
  const [project = '', folder = ''] = parts;
  const name = parts.at(-1) ?? '';
  const kind =
    name === 'roadmap.html' ? 'roadmap' : folder === 'tasks' ? 'task' : extname(name) === '.html' ? 'page' : 'doc';
  return { kind, project };
};

// The operator's documents only. The plugin's state, raw inputs and the pages it regenerates on every change
// (dashboard.html, projects/TASKS.md, reports/index.md) sit outside every zone.
const zonesOf = ({ home, projects, reports, knowledge }: HomeFolders): Zone[] => [
  {
    folder: home,
    keeps: ([name = '']) => IDENTITY_FILES.has(name) || name === 'roadmap.html',
    place: ([name]) => ({ kind: name === 'roadmap.html' ? 'roadmap' : 'identity', project: '' })
  },
  { folder: projects, enters: everything, keeps: (parts) => parts.length > 1, place: projectPlace },
  {
    folder: reports,
    // Screenshot captures, not reports.
    enters: ([category]) => category !== 'captures',
    keeps: (parts) => parts.length > 1,
    place: ([category = '']) => ({ kind: category, project: '' })
  },
  { folder: join(knowledge, 'user'), keeps: everything, place: kindOnly('knowledge') },
  { folder: join(knowledge, 'concepts'), keeps: everything, place: kindOnly('knowledge') },
  {
    folder: join(knowledge, 'memory'),
    keeps: ([name = '']) => name === 'index.md' || DAILY_MEMORY.test(name),
    place: kindOnly('memory')
  },
  {
    folder: join(home, 'extensions', 'skills'),
    keeps: ([name = '']) => extname(name) === '.md',
    place: kindOnly('extension')
  }
];

interface Changed extends Place {
  path: string;
  mtimeMs: number;
}

const isHidden = (name: string): boolean => name.startsWith('.') || name === 'node_modules';

const entriesOf = (folder: string): Dirent[] => {
  try {
    return readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
};

const walk = (home: string, zone: Zone, below: readonly string[] = []): Changed[] =>
  entriesOf(join(zone.folder, ...below)).flatMap((entry) => {
    const parts = [...below, entry.name];
    if (isHidden(entry.name)) {
      return [];
    }
    if (entry.isDirectory()) {
      return zone.enters?.(parts) ? walk(home, zone, parts) : [];
    }
    const absolute = join(zone.folder, ...parts);
    return entry.isFile() && EXTENSIONS.has(extname(entry.name)) && zone.keeps(parts)
      ? [{ path: relative(home, absolute), mtimeMs: statSync(absolute).mtimeMs, ...zone.place(parts) }]
      : [];
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
    return shown ? [{ ...shown, mtimeMs: Math.max(...group.map((file) => file.mtimeMs)) }] : [];
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
 * The newest files the operator would want back, newest first: at most RECENT_LIMIT changed in the last 30 days,
 * looked for wherever the home keeps its projects, reports and knowledge.
 */
export const readRecentFiles = (folders: HomeFolders = homeFolders(), now: number = Date.now()): RecentFile[] => {
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE, dateStyle: 'short', timeStyle: 'short' });
  const { home } = folders;
  return pairNotes(zonesOf(folders).flatMap((zone) => walk(home, zone)))
    .filter((file) => now - file.mtimeMs <= WINDOW_MS)
    .toSorted((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
    .slice(0, RECENT_LIMIT)
    .map(({ path, kind, project, mtimeMs }) => {
      const stamp = format.format(mtimeMs);
      return { path, kind, project, date: stamp.slice(0, 10), time: stamp.slice(11, 16), title: titleOf(home, path) };
    });
};
