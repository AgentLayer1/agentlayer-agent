import { z } from 'zod';

/**
 * The model's version. A reader treats a file with another version as missing, and the next rebuild rewrites it.
 */
export const WORK_SCHEMA = 5;

const PinSchema = z.object({ title: z.string(), icon: z.string(), path: z.string() });

const ProjectSchema = z.object({
  slug: z.string(),
  hue: z.number(),
  /**
   * The README's first plain paragraph.
   */
  description: z.string(),
  /**
   * HOME-relative paths of the project's own pages, '' when it has none.
   */
  roadmap: z.string(),
  attention: z.string(),
  pins: z.array(PinSchema)
});

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  project: z.string(),
  status: z.string(),
  priority: z.string(),
  due: z.string(),
  /**
   * When the operator plans to do it: a day, a week, a month or a quarter (tasks/horizon.ts).
   */
  horizon: z.string(),
  updated: z.string(),
  closed: z.string(),
  assignee: z.array(z.string()),
  dependsOn: z.array(z.string()),
  blockedBy: z.string(),
  /**
   * URL of the GitHub issue the task was handed off to, '' when none.
   */
  issue: z.string(),
  /**
   * Thread entries, automated status changes included.
   */
  comments: z.number(),
  /**
   * In the project's `tasks/archive/` folder.
   */
  archived: z.boolean(),
  /**
   * HOME-relative.
   */
  path: z.string()
});

const ReportSchema = z.object({
  /**
   * The day and time it was filed under in reports/index.md, or taken from its filename or mtime.
   */
  date: z.string(),
  time: z.string(),
  title: z.string(),
  /**
   * HOME-relative; '' for an index line without a link.
   */
  path: z.string(),
  skill: z.string(),
  /**
   * clean, findings, critical or draft, from the emoji on its index line; '' when none.
   */
  status: z.string(),
  /**
   * Its folder under reports/: briefings, plans, radar, api, reviews, helpdesk or slack.
   */
  category: z.string(),
  /**
   * When its file last changed (mtime); absent when there is no file to read.
   */
  changed: z.object({ date: z.string(), time: z.string() }).optional()
});

const GoalSchema = z.object({
  /**
   * A quarter (`Q4`, `Q1 2027`) on a yearly goal, '' otherwise.
   */
  label: z.string(),
  /**
   * The score written beside a quarter: ✅ ❌ 🟡 or ↪, '' when unscored.
   */
  mark: z.string(),
  title: z.string(),
  /**
   * What counts as done: a `(success: …)` or `(check: …)` clause, or a weekly goal's text after its dash.
   */
  check: z.string(),
  /**
   * Anything written after the headline and check, such as an added note.
   */
  detail: z.string()
});

const GoalBlockSchema = z.object({
  horizon: z.enum(['day', 'week', 'month', 'year']),
  /**
   * The date in the heading: the day a daily block is for, or the Monday a weekly one starts; '' when none.
   */
  date: z.string(),
  /**
   * The month a monthly block's intro opens with (`November 2026`), '' otherwise.
   */
  caption: z.string(),
  /**
   * The year's theme when the intro names one (`2026 theme: …`).
   */
  theme: z.object({ label: z.string(), text: z.string() }).nullable(),
  goals: z.array(GoalSchema),
  /**
   * The intro's other facts, then the lines after the goals; markdown stripped.
   */
  notes: z.array(z.string())
});

/**
 * The home's work as the files state it: its projects, every task file (live, closed and archived), its reports, its
 * pins and its goals. It holds no counts, dates of its own or judgements like "overdue"; those are views over it
 * (views.ts), so it changes only when the work does.
 */
const TasksSummarySchema = z.object({
  text: z.string(),
  /**
   * When it was written, an ISO time with an offset.
   */
  writtenAt: z.string()
});

export const WorkSchema = z.object({
  schema: z.literal(WORK_SCHEMA),
  agent: z.object({
    name: z.string(),
    emoji: z.string(),
    colors: z.object({ primary: z.string(), accent: z.string() })
  }),
  /**
   * HOME-relative path of the home's roadmap.html, '' when it has none.
   */
  roadmap: z.string(),
  projects: z.array(ProjectSchema),
  tasks: z.array(TaskSchema),
  /**
   * Every report, newest first.
   */
  reports: z.array(ReportSchema),
  /**
   * The live pins in reports/pinned.md, HOME-relative.
   */
  pins: z.array(PinSchema),
  /**
   * The goal blocks in projects/TASKS.md, in file order.
   */
  goals: z.array(GoalBlockSchema),
  /**
   * The model-written summary of the tasks in projects/TASKS.md, beside the goals.
   */
  tasksSummary: TasksSummarySchema.nullable(),
  /**
   * HOME-relative paths of task files that don't parse, so a broken task shows as broken rather than missing.
   */
  malformed: z.array(z.string())
});

export type Work = z.infer<typeof WorkSchema>;
export type WorkProject = Work['projects'][number];
export type WorkTask = Work['tasks'][number];
export type WorkReport = Work['reports'][number];
export type WorkGoalBlock = Work['goals'][number];
export type WorkGoal = WorkGoalBlock['goals'][number];
export type WorkTasksSummary = NonNullable<Work['tasksSummary']>;
