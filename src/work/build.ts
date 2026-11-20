import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { FILES, FOLDERS } from '@/config';
import { agentColors, agentDisplayName, agentEmoji } from '@/shared/agent-name';
import { firstParagraph } from '@/shared/text';
import { projectHue } from '@/status/html-primitives';
import { homePinLinks, projectHues, projectPinLinks } from '@/status/surfaces';
import { readReports } from '@/reports/read';
import { discoverProjects, scanTasks } from '@/tasks/scan';
import type { TaskFile } from '@/tasks/types';
import { readGoals } from './goals';
import { readTasksSummary } from './summary';
import { WORK_SCHEMA, type Work, type WorkProject, type WorkTask } from './model';

const fromHome = (path: string): string => relative(FOLDERS.HOME, path);

const toTask =
  (archived: boolean) =>
  (task: TaskFile): WorkTask => ({
    id: task.frontmatter.id,
    title: task.frontmatter.title,
    project: task.frontmatter.project,
    status: task.frontmatter.status,
    priority: task.frontmatter.priority,
    due: task.frontmatter.due,
    horizon: task.frontmatter.horizon,
    updated: task.frontmatter.updated,
    closed: task.frontmatter.closed,
    assignee: task.frontmatter.assignee,
    dependsOn: task.frontmatter.depends_on,
    blockedBy: task.frontmatter.blocked_by,
    issue: task.frontmatter.issue,
    comments: task.thread.length,
    archived,
    path: fromHome(task.filePath)
  });

const pageAt = (path: string): string => (existsSync(path) ? fromHome(path) : '');

// A project's own roadmap.html or attention.html sits at its root, as the home's do one level up.
const projectPage = (slug: string, file: 'roadmap.html' | 'attention.html'): string =>
  pageAt(resolve(FOLDERS.PROJECTS, slug, file));

const toProject =
  (hues: Readonly<Record<string, number>>) =>
  (slug: string): WorkProject => ({
    slug,
    hue: projectHue(slug, hues),
    description: firstParagraph(resolve(FOLDERS.PROJECTS, slug, 'README.md')),
    roadmap: projectPage(slug, 'roadmap.html'),
    attention: projectPage(slug, 'attention.html'),
    pins: projectPinLinks(slug)
  });

const byPath = (a: WorkTask, b: WorkTask): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * The task files alone, for what reads only tasks (TASKS.md before a task tool replies): one scan, ordered by path,
 * with no README, report or pin read.
 */
export const readTasks = (): Pick<Work, 'tasks' | 'malformed'> => {
  const scan = scanTasks();
  return {
    tasks: [...scan.tasks.map(toTask(false)), ...scan.archived.map(toTask(true))].toSorted(byPath),
    malformed: scan.malformed.map(fromHome)
  };
};

/**
 * Reads the home's work from its files: one scan of every task file, live, archived and unparseable, plus each
 * project's README, pages and pins, the reports, the home pins and the goals. Tasks are ordered by path and projects by slug, so
 * the same files always give the same model.
 */
export const buildWork = (): Work => {
  const { tasks, malformed } = readTasks();
  // A task can name a project that has no folder of its own; it still gets a card.
  const named = tasks.filter((task) => !task.archived).map((task) => task.project);
  const slugs = [...new Set([...discoverProjects(), ...named])].toSorted();
  return {
    schema: WORK_SCHEMA,
    agent: { name: agentDisplayName(), emoji: agentEmoji(), colors: agentColors() },
    roadmap: pageAt(FILES.ROADMAP),
    projects: slugs.map(toProject(projectHues())),
    tasks,
    reports: readReports(),
    pins: homePinLinks(),
    goals: readGoals(),
    tasksSummary: readTasksSummary(),
    malformed
  };
};
