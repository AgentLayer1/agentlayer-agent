/*
 * How a due date reads against a day: the dashboard and the cmux sidebar both class dates through this file. It
 * imports nothing, because the sidebar bundles it into cmux's runtime, where its typecheck has no Node or Bun.
 */

const DAY_MS = 86_400_000;

const dayNumber = (iso: string): number => {
  const [year, month, day] = iso.split('-').map(Number);
  return year && month && day ? Date.UTC(year, month - 1, day) / DAY_MS : Number.NaN;
};

/**
 * Whole days from `today` to `due`, both `YYYY-MM-DD`; null for no date or one that doesn't parse.
 */
export const daysUntil = (due: string, today: string): number | null => {
  const days = dayNumber(due) - dayNumber(today);
  return due && !Number.isNaN(days) ? days : null;
};

export const BUCKETS = ['overdue', 'today', 'week', 'month', 'later', 'someday'] as const;
export type DueBucket = (typeof BUCKETS)[number];

const bucketOf = (days: number | null): DueBucket => {
  if (days === null) {
    return 'someday';
  }
  if (days < 0) {
    return 'overdue';
  }
  if (days === 0) {
    return 'today';
  }
  return days <= 7 ? 'week' : days <= 30 ? 'month' : 'later';
};

/**
 * Where a due date falls on the agenda.
 */
export const dueBucket = (due: string, today: string): DueBucket => bucketOf(daysUntil(due, today));

export type DueTone = 'overdue' | 'soon' | 'later';

const TONE: Readonly<Record<DueBucket, DueTone>> = {
  overdue: 'overdue',
  today: 'soon',
  week: 'soon',
  month: 'later',
  later: 'later',
  someday: 'later'
};

/**
 * How urgent a due `days` away reads: overdue, soon (within a week) or later.
 */
export const toneOf = (days: number): DueTone => TONE[bucketOf(days)];
