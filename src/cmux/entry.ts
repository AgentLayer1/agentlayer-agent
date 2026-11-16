import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Work, WorkProject } from '@/work/model';
import { byPriorityThenDue, live, projectLoad } from '@/work/views';
import { SCHEMA, type HomeEntry, type PinItem, type ProjectCard, type TaskItem } from './sidebar/data';

const STATUS_ORDER: Readonly<Record<string, number>> = { active: 0, blocked: 1, open: 2 };

const statusRank = (status: string): number => STATUS_ORDER[status] ?? Object.keys(STATUS_ORDER).length;

const byUrgency = (a: TaskItem, b: TaskItem): number =>
  statusRank(a.status) - statusRank(b.status) || byPriorityThenDue(a, b) || a.id.localeCompare(b.id);

// Projects at work first, then the busiest, then by name, so the same tasks always render the same bytes.
const byWork = (a: ProjectCard, b: ProjectCard): number =>
  Number(b.active > 0) - Number(a.active > 0) ||
  b.active + b.open + b.blocked - (a.active + a.open + a.blocked) ||
  a.slug.localeCompare(b.slug);

const fileUrl = (path: string): string => pathToFileURL(path).href;

const pageUrl = (home: string, page: string): string | null => (page ? fileUrl(join(home, page)) : null);

const pinItem = (home: string, { title, icon, path }: WorkProject['pins'][number]): PinItem => {
  const absolute = join(home, path);
  return {
    title,
    icon,
    target: extname(path) === '.html' ? { kind: 'page', url: fileUrl(absolute) } : { kind: 'file', path: absolute }
  };
};

/**
 * What the sidebar shows of the home at `home`: its agent, pages, and each project's counts and live tasks.
 */
export const homeEntry = (home: string, work: Work): HomeEntry => {
  const liveTasks = live(work);
  const tasksOf = (project: string): TaskItem[] =>
    liveTasks
      .filter((task) => task.project === project)
      .map(({ id, title, status, priority, due, comments, path }) => ({
        id,
        title,
        status,
        priority,
        due,
        comments,
        path: join(home, path)
      }))
      .toSorted(byUrgency);
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
      pins: project.pins.map((pin) => pinItem(home, pin)),
      tasks: tasksOf(project.slug)
    };
  };
  return {
    schema: SCHEMA,
    name: work.agent.name,
    emoji: work.agent.emoji,
    dashboard: fileUrl(join(home, 'dashboard.html')),
    roadmap: pageUrl(home, work.roadmap),
    projects: work.projects.map(card).toSorted(byWork)
  };
};
