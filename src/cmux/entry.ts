import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reportKind } from '@/reports/kinds';
import { nameHue } from '@/status/html-primitives';
import type { Work, WorkGoal, WorkProject, WorkReport } from '@/work/model';
import { taskOrderById } from '@/work/order';
import { hueBySlug, live, projectLoad } from '@/work/views';
import {
  SCHEMA,
  type HomeEntry,
  type GoalItem,
  type GoalsItem,
  type PinItem,
  type PinTarget,
  type ProjectCard,
  type ReportItem,
  type TaskItem
} from './sidebar/data';

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
  const { title, date, time, status, path } = report;
  return { title, kind, hue: nameHue(kind), date, time, status, target: targetOf(home, path) };
};

// A goal that opens with a project's slug (`acme-app: …`) wears that project's pill instead.
const goalItem =
  (hues: Readonly<Record<string, number>>) =>
  (goal: WorkGoal, index: number): GoalItem => {
    const base = { ...goal, number: index + 1, project: null };
    const at = goal.title.indexOf(': ');
    const slug = at === -1 ? '' : goal.title.slice(0, at);
    const hue = hues[slug];
    if (hue === undefined) {
      return base;
    }
    const rest = goal.title.slice(at + 2);
    return { ...base, title: rest.charAt(0).toUpperCase() + rest.slice(1), project: { slug, hue } };
  };

const goalsOf = (work: Work): GoalsItem => {
  const toGoal = goalItem(hueBySlug(work));
  return {
    theme: work.goals.find((block) => block.theme)?.theme ?? null,
    blocks: work.goals.map(({ horizon, date, caption, goals, notes }) => ({
      horizon,
      date,
      caption,
      goals: goals.map(toGoal),
      notes
    }))
  };
};

/**
 * What the sidebar shows of the home at `home`: its agent, pages, each project's counts and live tasks, its pins, its
 * newest reports and its goals.
 */
export const homeEntry = (home: string, work: Work): HomeEntry => {
  // An index line without a link names a report nothing can open.
  const openable = work.reports.filter((report) => report.path !== '');
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
    dashboard: fileUrl(join(home, 'dashboard.html')),
    roadmap: pageUrl(home, work.roadmap),
    projects: work.projects.map(card).toSorted(byWork),
    tasks,
    pins: work.pins.map((pin) => pinItem(home, pin)),
    reports: openable.slice(0, REPORT_LIMIT).map((report) => reportItem(home, report)),
    olderReports: Math.max(0, openable.length - REPORT_LIMIT),
    goals: goalsOf(work)
  };
};
