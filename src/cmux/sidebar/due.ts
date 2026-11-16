const DAY_MS = 86_400_000;

const dayNumber = (iso: string): number => {
  const [year, month, day] = iso.split('-').map(Number);
  return year && month && day ? Date.UTC(year, month - 1, day) / DAY_MS : Number.NaN;
};

// Days from today to the due date; null for no date or one that doesn't parse.
const daysUntil = (due: string, today: string): number | null => {
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
 * Where a due date falls on the agenda, as the dashboard's Tasks page groups it.
 */
export const dueBucket = (due: string, today: string): DueBucket => bucketOf(daysUntil(due, today));

export interface DueLabel {
  text: string;
  tone: 'overdue' | 'soon' | 'later';
}

const TONE: Readonly<Record<DueBucket, DueLabel['tone']>> = {
  overdue: 'overdue',
  today: 'soon',
  week: 'soon',
  month: 'later',
  later: 'later',
  someday: 'later'
};

const wordsFor = (days: number): string => {
  if (days < 0) {
    return `overdue ${-days}d`;
  }
  if (days <= 1) {
    return days === 0 ? 'due today' : 'due tomorrow';
  }
  return `due in ${days}d`;
};

/**
 * A due date in words against today, both `YYYY-MM-DD`, toned by its agenda bucket; `null` for no date or one that
 * doesn't parse.
 */
export const dueLabel = (due: string, today: string): DueLabel | null => {
  const days = daysUntil(due, today);
  return days === null ? null : { text: wordsFor(days), tone: TONE[bucketOf(days)] };
};

/**
 * The local date of a moment given in epoch seconds, as `YYYY-MM-DD`.
 */
export const isoDay = (epochSeconds: number): string => {
  const date = new Date(epochSeconds * 1000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
