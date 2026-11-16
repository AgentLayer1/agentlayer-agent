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

/**
 * The local date of a moment given in epoch seconds, as `YYYY-MM-DD`.
 */
export const isoDay = (epochSeconds: number): string => {
  const date = new Date(epochSeconds * 1000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
