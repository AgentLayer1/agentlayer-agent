/*
 * How a date reads against a day: the dashboard and the cmux sidebar both class and word dates through this file. It
 * imports nothing, because the sidebar bundles it into cmux's runtime, where its typecheck has no Node or Bun.
 */

const DAY_MS = 86_400_000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The one reading of a `YYYY-MM-DD` date, as a UTC moment so no time zone shifts its day.
const utcOf = (iso: string): Date | null => {
  const [year, month, day] = iso.split('-').map(Number);
  return year && month && day ? new Date(Date.UTC(year, month - 1, day)) : null;
};

const dayNumber = (iso: string): number => (utcOf(iso)?.getTime() ?? Number.NaN) / DAY_MS;

/**
 * The date's day of the week from Monday (0) to Sunday (6); null when it doesn't parse.
 */
export const mondayIndex = (iso: string): number | null => {
  const date = utcOf(iso);
  return date ? (date.getUTCDay() + 6) % 7 : null;
};

/**
 * The date as `9 Nov`, or `Mon 9 Nov` with `weekday`; null when it doesn't parse.
 */
export const shortDate = (iso: string, { weekday = false } = {}): string | null => {
  const date = utcOf(iso);
  if (!date) {
    return null;
  }
  const dayMonth = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ''}`;
  return weekday ? `${WEEKDAYS[date.getUTCDay()] ?? ''} ${dayMonth}` : dayMonth;
};

/**
 * Whole days from `today` to `due`, both `YYYY-MM-DD`; null for no date or one that doesn't parse.
 */
export const daysUntil = (due: string, today: string): number | null => {
  const days = dayNumber(due) - dayNumber(today);
  return due && !Number.isNaN(days) ? days : null;
};

/**
 * Whether a goal block dated `date` still speaks for `today`: a day's only on that day, a week's through that week,
 * a month's or a year's always.
 */
export const goalPeriodHolds = (horizon: string, date: string, today: string): boolean => {
  const days = daysUntil(date, today);
  if (horizon === 'day') {
    return days === 0;
  }
  return horizon !== 'week' || days === null || days >= -(mondayIndex(today) ?? 0);
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
