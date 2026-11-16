import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Persona, ProjectLoad, StatusSnapshot, SurfaceLink, TaskRef } from '@/status/collect';
import { projectHue } from '@/status/html-primitives';
import { SCHEMA, type HomeEntry, type ProjectCard, type TaskItem } from './sidebar/data';

/**
 * The slice of a dashboard snapshot the sidebar reads. Nothing that changes without a task or project changing fits.
 */
export interface EntrySource {
  runtime: Pick<StatusSnapshot['runtime'], 'home'>;
  persona: Pick<Persona, 'name' | 'emoji'>;
  projectHues: Readonly<Record<string, number>>;
  surfaces: readonly Pick<SurfaceLink, 'href'>[];
  tasks: {
    byProject: readonly Pick<ProjectLoad, 'project' | 'active' | 'open' | 'blocked' | 'done'>[];
    queue: readonly Pick<TaskRef, 'id' | 'title' | 'status' | 'priority' | 'due' | 'project' | 'path'>[];
  };
}

const STATUS_ORDER: Readonly<Record<string, number>> = { active: 0, blocked: 1, open: 2 };

const statusRank = (status: string): number => STATUS_ORDER[status] ?? Object.keys(STATUS_ORDER).length;

const byUrgency = (a: TaskItem, b: TaskItem): number =>
  statusRank(a.status) - statusRank(b.status) ||
  a.priority.localeCompare(b.priority) ||
  (a.due || '9999').localeCompare(b.due || '9999') ||
  a.id.localeCompare(b.id);

// Projects at work first, then the busiest, then by name, so the same tasks always render the same bytes.
const byWork = (a: ProjectCard, b: ProjectCard): number =>
  Number(b.active > 0) - Number(a.active > 0) ||
  b.active + b.open + b.blocked - (a.active + a.open + a.blocked) ||
  a.slug.localeCompare(b.slug);

const fileUrl = (path: string): string => pathToFileURL(path).href;

export const homeEntry = (source: EntrySource): HomeEntry => {
  const home = source.runtime.home;
  const roadmap = join(home, 'roadmap.html');
  const tasksOf = (project: string): TaskItem[] =>
    source.tasks.queue
      .filter((task) => task.project === project)
      .map(({ id, title, status, priority, due, path }) => ({
        id,
        title,
        status,
        priority,
        due,
        path: join(home, path)
      }))
      .sort(byUrgency);
  return {
    schema: SCHEMA,
    name: source.persona.name,
    emoji: source.persona.emoji,
    dashboard: fileUrl(join(home, 'dashboard.html')),
    roadmap: source.surfaces.some((link) => link.href === roadmap) ? fileUrl(roadmap) : null,
    projects: source.tasks.byProject
      .map(({ project, active, open, blocked, done }) => ({
        slug: project,
        hue: projectHue(project, source.projectHues),
        active,
        open,
        blocked,
        done,
        tasks: tasksOf(project)
      }))
      .sort(byWork)
  };
};
