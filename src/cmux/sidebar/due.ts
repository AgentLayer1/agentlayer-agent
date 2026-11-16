const DAY_MS = 86_400_000;

const dayNumber = (iso: string): number => {
  const [year, month, day] = iso.split('-').map(Number);
  return year && month && day ? Date.UTC(year, month - 1, day) / DAY_MS : Number.NaN;
};

export interface DueLabel {
  text: string;
  tone: 'overdue' | 'soon' | 'later';
}

/**
 * A due date in words against today, both `YYYY-MM-DD`; `null` for no date or one that doesn't parse.
 */
export const dueLabel = (due: string, today: string): DueLabel | null => {
  const days = dayNumber(due) - dayNumber(today);
  if (!due || Number.isNaN(days)) {
    return null;
  }
  if (days < 0) {
    return { text: `overdue ${-days}d`, tone: 'overdue' };
  }
  if (days <= 1) {
    return { text: days === 0 ? 'due today' : 'due tomorrow', tone: 'soon' };
  }
  return { text: `due in ${days}d`, tone: days <= 7 ? 'soon' : 'later' };
};

export const BUCKETS = ['overdue', 'today', 'week', 'month', 'later', 'someday'] as const;
export type DueBucket = (typeof BUCKETS)[number];

/**
 * Where a due date falls on the agenda, as the dashboard's Tasks page groups it.
 */
export const dueBucket = (due: string, today: string): DueBucket => {
  const days = dayNumber(due) - dayNumber(today);
  if (!due || Number.isNaN(days)) {
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
 * The local date of a moment given in epoch seconds, as `YYYY-MM-DD`.
 */
export const isoDay = (epochSeconds: number): string => {
  const date = new Date(epochSeconds * 1000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
