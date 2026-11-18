import { shiftDate } from '@/shared/date';
import type { Work, WorkGoal, WorkGoalBlock, WorkProject, WorkReport, WorkTask } from './model';
import { taskOrder } from './order';

// What the task rules read; TASKS.md hands them tasks alone, without the rest of the model.
type Tasks = Pick<Work, 'tasks'>;

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
const inPlace = (work: Tasks): WorkTask[] => work.tasks.filter((task) => !task.archived);

export const live = (work: Tasks): WorkTask[] => inPlace(work).filter((task) => !isClosed(task.status));

/**
 * Tasks in place with any of `statuses`.
 */
export const withStatus = (work: Tasks, ...statuses: string[]): WorkTask[] =>
  inPlace(work).filter((task) => statuses.includes(task.status));

export const overdue = (work: Tasks, today: string): WorkTask[] =>
  inPlace(work).filter((task) => isOverdue(task, today));

export const stale = (work: Tasks, today: string): WorkTask[] => inPlace(work).filter((task) => isStale(task, today));

/**
 * Closed tasks still in place whose `closed:` date is on or after `since`.
 */
export const closedSince = (work: Tasks, since: string): WorkTask[] =>
  inPlace(work).filter((task) => isClosed(task.status) && task.closed !== '' && task.closed >= since);

/**
 * Tasks in place updated today or yesterday: dates carry no time, so yesterday keeps the list from emptying at
 * midnight.
 */
export const touchedRecently = (work: Tasks, today: string): WorkTask[] =>
  inPlace(work).filter((task) => task.updated >= shiftDate(today, -1) && task.updated <= today);

export const queue = (work: Tasks): WorkTask[] => live(work).toSorted(taskOrder);

export interface GoalView extends WorkGoal {
  /**
   * Its place in its block, from 1.
   */
  number: number;
  /**
   * The slug of the project its title opened with (`acme-app: …`), which the title then drops; '' when none.
   */
  project: string;
}

export interface GoalsView {
  theme: WorkGoalBlock['theme'];
  blocks: (Pick<WorkGoalBlock, 'horizon' | 'date' | 'caption' | 'notes'> & { goals: GoalView[] })[];
}

/**
 * The goals as every screen shows them: the year's theme, then each block with its goals numbered and tagged with
 * their project.
 */
export const goalsView = (work: Pick<Work, 'goals' | 'projects'>): GoalsView => {
  const slugs = new Set(work.projects.map((project) => project.slug));
  const goalView = (goal: WorkGoal, index: number): GoalView => {
    const base = { ...goal, number: index + 1, project: '' };
    const at = goal.title.indexOf(': ');
    const slug = at === -1 ? '' : goal.title.slice(0, at);
    if (!slugs.has(slug)) {
      return base;
    }
    const rest = goal.title.slice(at + 2);
    return { ...base, title: rest.charAt(0).toUpperCase() + rest.slice(1), project: slug };
  };
  return {
    theme: work.goals.find((block) => block.theme)?.theme ?? null,
    blocks: work.goals.map(({ horizon, date, caption, notes, goals }) => ({
      horizon,
      date,
      caption,
      notes,
      goals: goals.map(goalView)
    }))
  };
};

/**
 * Each project's hue by its slug.
 */
export const hueBySlug = (work: Pick<Work, 'projects'>): Record<string, number> =>
  Object.fromEntries(work.projects.map((project) => [project.slug, project.hue]));

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

type Moment = Pick<WorkReport, 'date' | 'time'>;

const momentKey = ({ date, time }: Moment): string => `${date} ${time}`;

/**
 * When a report last changed: when it was filed, or when its file was edited after that.
 */
export const lastUpdate = (report: WorkReport): Moment =>
  report.changed && momentKey(report.changed) > momentKey(report)
    ? report.changed
    : { date: report.date, time: report.time };

/**
 * Reports by their last update, newest first.
 */
export const byLastUpdate = (reports: readonly WorkReport[]): WorkReport[] =>
  reports.toSorted((a, b) => momentKey(lastUpdate(b)).localeCompare(momentKey(lastUpdate(a))));
