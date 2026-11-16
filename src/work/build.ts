import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { FOLDERS } from '@/config';
import { agentDisplayName, agentEmoji } from '@/shared/agent-name';
import { firstParagraph } from '@/shared/text';
import { projectHue } from '@/status/html-primitives';
import { projectHues, projectPinLinks } from '@/status/surfaces';
import { discoverProjects, scanAllTasks, scanArchivedTasks } from '@/tasks/scan';
import type { TaskFile } from '@/tasks/types';
import { WORK_SCHEMA, type Work, type WorkProject, type WorkTask } from './model';

const toTask =
  (archived: boolean) =>
  (task: TaskFile): WorkTask => ({
    id: task.frontmatter.id,
    title: task.frontmatter.title,
    project: task.frontmatter.project,
    status: task.frontmatter.status,
    priority: task.frontmatter.priority,
    due: task.frontmatter.due,
    updated: task.frontmatter.updated,
    closed: task.frontmatter.closed,
    assignee: task.frontmatter.assignee,
    dependsOn: task.frontmatter.depends_on,
    blockedBy: task.frontmatter.blocked_by,
    issue: task.frontmatter.issue,
    comments: task.thread.length,
    archived,
    path: relative(FOLDERS.HOME, task.filePath)
  });

// A project's own roadmap.html or attention.html sits at its root, as the home's do one level up.
const projectPage = (slug: string, file: 'roadmap.html' | 'attention.html'): string => {
  const path = resolve(FOLDERS.PROJECTS, slug, file);
  return existsSync(path) ? relative(FOLDERS.HOME, path) : '';
};

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
 * Reads the home's work from its files: one scan of every task, live and archived, plus each project's README,
 * pages and pins. Tasks are ordered by path and projects by slug, so the same files always give the same model.
 */
export const buildWork = (): Work => {
  const tasks = [...scanAllTasks().map(toTask(false)), ...scanArchivedTasks().map(toTask(true))].toSorted(byPath);
  // A task can name a project that has no folder of its own; it still gets a card.
  const named = tasks.filter((task) => !task.archived).map((task) => task.project);
  const slugs = [...new Set([...discoverProjects(), ...named])].toSorted();
  return {
    schema: WORK_SCHEMA,
    agent: { name: agentDisplayName(), emoji: agentEmoji() },
    projects: slugs.map(toProject(projectHues())),
    tasks
  };
};
