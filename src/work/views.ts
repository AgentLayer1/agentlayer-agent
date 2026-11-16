import { shiftDate } from '@/shared/date';
import type { Work, WorkProject, WorkTask } from './model';

export const DUE_SOON_DAYS = 14;
const STALE_DAYS = 7;

const CLOSED = new Set(['done', 'cancelled']);

const isClosed = (status: string): boolean => CLOSED.has(status);

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

/**
 * Tasks in place with any of `statuses`.
 */
export const withStatus = (work: Work, ...statuses: string[]): WorkTask[] =>
  inPlace(work).filter((task) => statuses.includes(task.status));

export const overdue = (work: Work, today: string): WorkTask[] =>
  inPlace(work).filter((task) => isOverdue(task, today));

export const stale = (work: Work, today: string): WorkTask[] => inPlace(work).filter((task) => isStale(task, today));

/**
 * Closed tasks still in place whose `closed:` date is on or after `since`.
 */
export const closedSince = (work: Work, since: string): WorkTask[] =>
  inPlace(work).filter((task) => isClosed(task.status) && task.closed !== '' && task.closed >= since);

/**
 * Tasks in place updated today or yesterday: dates carry no time, so yesterday keeps the list from emptying at
 * midnight.
 */
export const touchedRecently = (work: Work, today: string): WorkTask[] =>
  inPlace(work).filter((task) => task.updated >= shiftDate(today, -1) && task.updated <= today);

const PRIORITY_ORDER: Readonly<Record<string, number>> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * P0 first; a priority outside P0–P3 (a hand edit) sorts after P3.
 */
export const priorityRank = (priority: string): number => PRIORITY_ORDER[priority] ?? 9;

/**
 * Highest priority first, then earliest due; undated last.
 */
export const byPriorityThenDue = (a: Pick<WorkTask, 'priority' | 'due'>, b: Pick<WorkTask, 'priority' | 'due'>) =>
  priorityRank(a.priority) - priorityRank(b.priority) || (a.due || '9999').localeCompare(b.due || '9999');

export const queue = (work: Work): WorkTask[] => live(work).toSorted(byPriorityThenDue);

export interface ProjectLoad extends Pick<WorkProject, 'description' | 'roadmap' | 'attention' | 'pins'> {
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
}

/**
 * One project's counts and pages.
 */
export const projectLoad = (work: Work, { slug, description, roadmap, attention, pins }: WorkProject): ProjectLoad => {
  const tasks = work.tasks.filter((task) => task.project === slug);
  const placed = tasks.filter((task) => !task.archived);
  const counted = (status: string) => placed.filter((task) => task.status === status).length;
  const [open, active, blocked] = [counted('open'), counted('active'), counted('blocked')];
  return {
    project: slug,
    open,
    active,
    blocked,
    total: open + active + blocked,
    done: tasks.length - (open + active + blocked),
    updatedAt: placed.reduce((latest, task) => (task.updated > latest ? task.updated : latest), ''),
    description,
    roadmap,
    attention,
    pins
  };
};

/**
 * Each project's counts and pages: the most recently touched first, then the busiest, then by name, so quiet
 * projects sink to the bottom in a fixed order.
 */
export const projectLoads = (work: Work): ProjectLoad[] =>
  work.projects
    .map((project) => projectLoad(work, project))
    .toSorted(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.total - a.total || a.project.localeCompare(b.project)
    );
