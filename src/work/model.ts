import { z } from 'zod';

/**
 * The model's version. A reader treats a file with another version as missing, and the next rebuild rewrites it.
 */
export const WORK_SCHEMA = 1;

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

/**
 * The home's work as the files state it: its projects and every task file, live, closed and archived. It holds no
 * counts, dates of its own or judgements like "overdue"; those are views over it (views.ts), so it changes only
 * when the work does.
 */
export const WorkSchema = z.object({
  schema: z.literal(WORK_SCHEMA),
  agent: z.object({ name: z.string(), emoji: z.string() }),
  /**
   * HOME-relative path of the home's roadmap.html, '' when it has none.
   */
  roadmap: z.string(),
  projects: z.array(ProjectSchema),
  tasks: z.array(TaskSchema),
  /**
   * HOME-relative paths of task files that don't parse, so a broken task shows as broken rather than missing.
   */
  malformed: z.array(z.string())
});

export type Work = z.infer<typeof WorkSchema>;
export type WorkProject = Work['projects'][number];
export type WorkTask = Work['tasks'][number];
