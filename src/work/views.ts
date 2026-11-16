import { shiftDate } from '@/shared/date';
import type { Work, WorkProject, WorkTask } from './model';

export const DUE_SOON_DAYS = 14;
const STALE_DAYS = 7;

const CLOSED = new Set(['done', 'cancelled']);

export const isClosed = (status: string): boolean => CLOSED.has(status);

/**
 * The fields the date rules read, so a parsed task file and a model task share them.
 */
interface Dated {
  status: string;
  due: string;
  updated: string;
}

export const isOverdue = (task: Dated, today: string): boolean =>
  !isClosed(task.status) && task.due !== '' && task.due < today;

/**
 * Open work due today or within DUE_SOON_DAYS; an overdue task counts as overdue, not here.
 */
export const isDueSoon = (task: Dated, today: string): boolean =>
  !isClosed(task.status) && task.due !== '' && task.due >= today && task.due <= shiftDate(today, DUE_SOON_DAYS);

/**
 * Open work with no update in STALE_DAYS or more.
 */
export const isStale = (task: Dated, today: string): boolean =>
  !isClosed(task.status) && task.updated !== '' && task.updated < shiftDate(today, -STALE_DAYS);

/**
 * Task files in the projects' `tasks/` folders, closed ones included; archived tasks are left out.
 */
export const inPlace = (work: Work): WorkTask[] => work.tasks.filter((task) => !task.archived);

export const live = (work: Work): WorkTask[] => inPlace(work).filter((task) => !isClosed(task.status));

export const overdue = (work: Work, today: string): WorkTask[] =>
  inPlace(work).filter((task) => isOverdue(task, today));

export const stale = (work: Work, today: string): WorkTask[] => inPlace(work).filter((task) => isStale(task, today));

/**
 * Closed tasks still in place whose `closed:` date is on or after `since`.
 */
export const closedSince = (work: Work, since: string): WorkTask[] =>
  inPlace(work).filter((task) => isClosed(task.status) && task.closed !== '' && task.closed >= since);

/**
 * Tasks in place updated between `since` and `today`, inclusive.
 */
export const updatedBetween = (work: Work, since: string, today: string): WorkTask[] =>
  inPlace(work).filter((task) => task.updated >= since && task.updated <= today);

/**
 * The live tasks, highest priority first, then earliest due.
 */
export const queue = (work: Work): WorkTask[] =>
  live(work).toSorted(
    (a, b) => a.priority.localeCompare(b.priority) || (a.due || '9999').localeCompare(b.due || '9999')
  );

export interface ProjectLoad {
  project: string;
  open: number;
  active: number;
  blocked: number;
  /**
   * Open + active + blocked: the live working set.
   */
  total: number;
  /**
   * Closed tasks, in place and archived.
   */
  done: number;
  /**
   * The latest `updated:` across the project's tasks in place; '' when it has none.
   */
  updatedAt: string;
  description: string;
  roadmap: string;
  attention: string;
  pins: WorkProject['pins'];
}

const loadOf = (project: WorkProject, tasks: readonly WorkTask[]): ProjectLoad => {
  const placed = tasks.filter((task) => !task.archived);
  const withStatus = (status: string) => placed.filter((task) => task.status === status).length;
  const [open, active, blocked] = [withStatus('open'), withStatus('active'), withStatus('blocked')];
  return {
    project: project.slug,
    open,
    active,
    blocked,
    total: open + active + blocked,
    done: tasks.length - (open + active + blocked),
    updatedAt: placed.reduce((latest, task) => (task.updated > latest ? task.updated : latest), ''),
    description: project.description,
    roadmap: project.roadmap,
    attention: project.attention,
    pins: project.pins
  };
};

/**
 * Each project's counts and pages: the most recently touched first, then the busiest, then by name, so quiet
 * projects sink to the bottom in a fixed order.
 */
export const projectLoads = (work: Work): ProjectLoad[] =>
  work.projects
    .map((project) =>
      loadOf(
        project,
        work.tasks.filter((task) => task.project === project.slug)
      )
    )
    .toSorted(
      (a, b) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || '') || b.total - a.total || a.project.localeCompare(b.project)
    );
