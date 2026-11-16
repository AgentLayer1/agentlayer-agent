import { daysUntil, toneOf, type DueTone } from '../../work/due';

export interface DueLabel {
  text: string;
  tone: DueTone;
}

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
 * A due date in the sidebar's words against today, both `YYYY-MM-DD`; `null` for no date or one that doesn't parse.
 */
export const dueLabel = (due: string, today: string): DueLabel | null => {
  const days = daysUntil(due, today);
  return days === null ? null : { text: wordsFor(days), tone: toneOf(days) };
};

/**
 * The local date of a moment given in epoch seconds, as `YYYY-MM-DD`.
 */
export const isoDay = (epochSeconds: number): string => {
  const date = new Date(epochSeconds * 1000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
