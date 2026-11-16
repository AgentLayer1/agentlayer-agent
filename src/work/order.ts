/*
 * The one order for task lists, shared by the dashboard, TASKS.md and the cmux sidebar's bundle, so it imports nothing.
 */

const PRIORITY_ORDER: Readonly<Record<string, number>> = { P0: 0, P1: 1, P2: 2, P3: 3 };

// A priority outside P0–P3 (a hand edit) sorts after P3.
const priorityRank = (priority: string): number => PRIORITY_ORDER[priority] ?? 9;

interface Ranked {
  priority: string;
  due: string;
  updated: string;
}

/**
 * Highest priority first, then the earliest due date (undated last), then the most recently updated.
 */
export const taskOrder = (a: Ranked, b: Ranked): number =>
  priorityRank(a.priority) - priorityRank(b.priority) ||
  (a.due || '9999').localeCompare(b.due || '9999') ||
  b.updated.localeCompare(a.updated);

/**
 * `taskOrder`, then by id, so the same tasks always come out in the same order.
 */
export const taskOrderById = (a: Ranked & { id: string }, b: Ranked & { id: string }): number =>
  taskOrder(a, b) || a.id.localeCompare(b.id);
