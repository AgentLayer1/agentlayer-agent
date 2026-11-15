export type TaskStatus = 'open' | 'active' | 'blocked' | 'done' | 'cancelled';
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TaskType = 'task' | 'bug' | 'idea' | 'epic';

export interface TaskFrontmatter {
  schema: number;
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  project: string;
  assignee: string[];
  labels: string[];
  created: string;
  updated: string;
  due: string;
  horizon: string;
  depends_on: string[];
  blocked_by: string;
  parent: string;
  issue: string;
  closed: string;
}

export interface ChecklistItem {
  checked: boolean;
  text: string;
}

export interface ThreadEntry {
  type: 'quote' | 'info' | 'warning';
  author: string;
  timestamp: string;
  message: string;
}

export interface TaskFile {
  frontmatter: TaskFrontmatter;
  description: string;
  checklist: ChecklistItem[];
  thread: ThreadEntry[];
  filePath: string;
}

export interface ParsedFrontmatter {
  frontmatter: TaskFrontmatter;
  extraLines: string[];
}

export interface CreateTaskOptions {
  project: string;
  title: string;
  description: string;
  assignee: string[];
  priority?: TaskPriority;
  type?: TaskType;
  labels?: string[];
  due?: string;
  horizon?: string;
  depends_on?: string[];
  blocked_by?: string;
  parent?: string;
  checklist?: string[];
}

export interface UpdateTaskOptions extends Partial<Omit<TaskFrontmatter, 'id' | 'schema' | 'created'>> {
  /**
   * Replaces the Description section's text; checklist and thread are kept.
   */
  description?: string;
}

/**
 * Thrown when a task mutation writes to disk but the re-read shows a different
 * value than requested. Indicates serialization round-trip drift, partial write,
 * or sandbox rejection — never silently treated as success.
 */
export class PostWriteDriftError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly field: string,
    public readonly expected: unknown,
    public readonly actual: unknown,
    public readonly path: string
  ) {
    super(
      `Post-write drift on ${taskId}: requested ${field}=${JSON.stringify(expected)}, file shows ${JSON.stringify(actual)}. Write did not persist.`
    );
    this.name = 'PostWriteDriftError';
  }
}
