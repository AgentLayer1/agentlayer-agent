import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { FILES, FOLDERS } from '@/config';
import { splitFrontmatter } from '@/knowledge/utils';
import { nowTime, todayDate } from '@/shared/date';
import { listMarkdown, MARKDOWN_RE, readText } from '@/shared/text';
import type { WorkReport } from '@/work/model';
import { REPORT_CATEGORIES } from './kinds';

// A title's own brackets are written escaped (`\[draft\]`), so the link text runs to the first bare `]`. The status
// is written as an emoji and its word (`· 🟠 findings`); the word is kept.
const INDEX_LINE = /^- (\d{2}:\d{2}) · \[((?:\\.|[^\]\\])+)\](?:\(([^)]+)\))?(?: · `([^`]+)`)?(?: · \S+ (\w+))?/;

/** Category segment from a path like `reports/plans/2026-…md` → `plans`. */
const categoryOf = (path: string): string => path.split('/')[1] ?? '';

/** Display title for an orphan report file (one written outside report_write,
 *  e.g. a plan-mode export): frontmatter `title:`, else the first H1, else the
 *  filename. */
const orphanTitle = (content: string, fileName: string): string => {
  const { frontmatter, body } = splitFrontmatter(content);
  const fmTitle = frontmatter
    .match(/^title:[ \t]*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  if (fmTitle) return fmTitle;
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fileName.replace(MARKDOWN_RE, '');
};

const safeMtime = (path: string): Date => {
  try {
    return statSync(path).mtime;
  } catch {
    return new Date(0);
  }
};

/** Every report, newest first. Two sources merged:
 *  1. `reports/index.md` — the authoritative, curated log (title/skill/status)
 *     written by `report_write`.
 *  2. A disk sweep of each category folder for files NOT in the index — chiefly
 *     plans saved by the harness's plan-mode export, which never touch the
 *     index. Without (2) those plans never surface. */
export const readReports = (): WorkReport[] => {
  const refs: WorkReport[] = [];
  const seen = new Set<string>();

  try {
    let day = '';
    for (const line of readText(FILES.REPORTS_INDEX).split('\n')) {
      const heading = line.match(/^## (\d{4}-\d{2}-\d{2})/);
      if (heading) {
        day = heading[1];
        continue;
      }
      const entry = line.match(INDEX_LINE);
      if (!entry) continue;
      // Index links are relative to reports/; paths here are HOME-relative.
      const path = entry[3] ? `reports/${entry[3]}` : '';
      if (path) seen.add(path);
      refs.push({
        date: day,
        time: entry[1],
        title: entry[2].replace(/\\([[\]])/g, '$1'),
        path,
        skill: entry[4] ?? '',
        status: entry[5] ?? '',
        category: categoryOf(path)
      });
    }
  } catch {
    // No index yet — the disk sweep below still surfaces any orphan files.
  }

  for (const category of REPORT_CATEGORIES) {
    const dir = resolve(FOLDERS.REPORTS, category);
    for (const fileName of listMarkdown(dir)) {
      const path = `reports/${category}/${fileName}`;
      if (seen.has(path)) continue;
      seen.add(path);
      const full = resolve(dir, fileName);
      let body = '';
      try {
        body = readText(full);
      } catch {
        continue;
      }
      // A filename's YYYY-MM-DD-HHMM stamp gives its day and time; a file without one goes by when it last changed.
      const stamp = fileName.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/);
      const changed = safeMtime(full);
      refs.push({
        date: stamp?.[1] ?? todayDate(changed),
        time: stamp ? `${stamp[2]}:${stamp[3]}` : nowTime(changed),
        title: orphanTitle(body, fileName),
        path,
        skill: '',
        status: '',
        category
      });
    }
  }

  return refs.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
};
