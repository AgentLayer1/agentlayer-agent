import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { placeOf, readHeartbeat, type Heartbeat } from '@/heartbeat/ledger';
import { EMPTY_NOTES, readNotes, type NoteLedger } from '@/notes/ledger';
import { recentNotes } from '@/notes/rules';
import { EMPTY_LEDGER, readProposalLedger, type ProposalLedger } from '@/proposals/ledger';
import { proposalCards } from '@/proposals/rules';
import { reportKind } from '@/reports/kinds';
import { configuredRepoPaths, homeLauncher } from '@/config';
import { pluginName } from '@/shared/naming';
import { nameHue } from '@/status/html-primitives';
import type { Work, WorkProject, WorkReport } from '@/work/model';
import { taskOrderById } from '@/work/order';
import { byLastUpdate, goalsView, lastUpdate, live, projectLoad } from '@/work/views';
import {
  SCHEMA,
  type HeartbeatPlace,
  type HomeEntry,
  type PinItem,
  type PinTarget,
  type ProjectCard,
  type RecentItem,
  type ReportItem,
  type TaskItem
} from './sidebar/data';
import { readRecentFiles, recentPlace, stemOf, type RecentFile } from './recent';

// Enough for a few weeks of reports while keeping the shared sidebar file small; the dashboard lists them all.
export const REPORT_LIMIT = 40;

// Projects at work first, then the busiest, then by name, so the same tasks always render the same bytes.
const byWork = (a: ProjectCard, b: ProjectCard): number =>
  Number(b.active > 0) - Number(a.active > 0) ||
  b.active + b.open + b.blocked - (a.active + a.open + a.blocked) ||
  a.slug.localeCompare(b.slug);

const fileUrl = (path: string): string => pathToFileURL(path).href;

const pageUrl = (home: string, page: string): string | null => (page ? fileUrl(join(home, page)) : null);

const targetOf = (home: string, path: string): PinTarget => {
  const absolute = join(home, path);
  return extname(path) === '.html' ? { kind: 'page', url: fileUrl(absolute) } : { kind: 'file', path: absolute };
};

const pinItem = (home: string, { title, icon, path }: WorkProject['pins'][number]): PinItem => ({
  title,
  icon,
  target: targetOf(home, path)
});

const reportItem = (home: string, report: WorkReport): ReportItem => {
  const kind = reportKind(report);
  const { title, status, path } = report;
  return { title, kind, hue: nameHue(kind), ...lastUpdate(report), status, target: targetOf(home, path) };
};

/**
 * What the sidebar draws of a home besides its work: the proposals waiting, the notes sent, the heartbeat, and the
 * files changed lately.
 */
export interface HomeState {
  proposals: ProposalLedger;
  notes: NoteLedger;
  heartbeat: Heartbeat | null;
  recent: RecentFile[];
}

export const readHomeState = (): HomeState => ({
  proposals: readProposalLedger(),
  notes: readNotes(),
  heartbeat: readHeartbeat(),
  recent: readRecentFiles()
});

// A row shows a page over its note, and the reports index may name either one.
const recentItems = (home: string, work: Work, files: readonly RecentFile[]): RecentItem[] => {
  const tasks = new Map(work.tasks.map((task) => [task.path, task.title]));
  const reports = new Map(work.reports.map((report) => [report.path, report]));
  return files.map(({ path, date, time, title }) => {
    const report = reports.get(path) ?? reports.get(`${stemOf(path)}.md`);
    const place = recentPlace(path);
    // A report keeps the kind the Reports section gives it.
    const kind = report ? reportKind(report) : place.kind;
    return {
      title: tasks.get(path) ?? report?.title ?? title,
      kind,
      hue: nameHue(kind),
      project: place.project,
      date,
      time,
      target: targetOf(home, path)
    };
  });
};

// The heartbeat's cmux tab, where the sidebar's buttons type; null when it isn't a cmux session.
const heartbeatPlace = (heartbeat: Heartbeat | null): HeartbeatPlace | null => {
  const place = placeOf(heartbeat, 'cmux');
  return place ? { surfaceId: place.surfaceId, workspaceId: place.workspaceId } : null;
};

/**
 * What the sidebar shows of the home at `home`: its agent, pages, each project's counts and live tasks, its pins, its
 * newest reports, the files changed lately, its goals, the proposals waiting with the heartbeat that decides them, and
 * today's and yesterday's notes.
 */
export const homeEntry = (
  home: string,
  work: Work,
  { proposals = EMPTY_LEDGER, notes = EMPTY_NOTES, heartbeat = null, recent = [] }: Partial<HomeState> = {}
): HomeEntry => {
  // An index line without a link names a report nothing can open.
  const openable = byLastUpdate(work.reports.filter((report) => report.path !== ''));
  const tasks = live(work)
    .toSorted(taskOrderById)
    .map(
      ({ id, title, project, status, priority, due, comments, path }): TaskItem => ({
        id,
        title,
        project,
        status,
        priority,
        due,
        comments,
        path: join(home, path)
      })
    );
  const card = (project: WorkProject): ProjectCard => {
    const { active, open, blocked, done } = projectLoad(work, project);
    return {
      slug: project.slug,
      hue: project.hue,
      active,
      open,
      blocked,
      done,
      roadmap: pageUrl(home, project.roadmap),
      pins: project.pins.map((pin) => pinItem(home, pin))
    };
  };
  return {
    schema: SCHEMA,
    name: work.agent.name,
    emoji: work.agent.emoji,
    colors: work.agent.colors,
    dashboard: fileUrl(join(home, 'dashboard.html')),
    roadmap: pageUrl(home, work.roadmap),
    projects: work.projects.map(card).toSorted(byWork),
    tasks,
    pins: work.pins.map((pin) => pinItem(home, pin)),
    reports: openable.slice(0, REPORT_LIMIT).map((report) => reportItem(home, report)),
    olderReports: Math.max(0, openable.length - REPORT_LIMIT),
    recent: recentItems(home, work, recent),
    goals: goalsView(work),
    tasksSummary: work.tasksSummary,
    proposals: proposalCards(proposals),
    notes: recentNotes(notes, new Date()).map(({ id, title, body, next, sources, at, prompt, reaction }) => ({
      id,
      title,
      body,
      next,
      sources,
      at,
      canStart: prompt !== '',
      reaction
    })),
    heartbeat: heartbeatPlace(heartbeat),
    launcher: homeLauncher(home),
    codeFolders: configuredRepoPaths(),
    home,
    plugin: pluginName()
  };
};
