import { TIMEZONE } from '@/config';

// All timestamps in local TIMEZONE for human readability. The explicit offset
// on nowISO() keeps it unambiguous without relying on the reader's clock.

/**
 * ISO-8601 offset string (e.g. "+08:00", "-05:00", "+00:00") for `TIMEZONE`
 * at the given instant. Honours DST by computing per-date.
 */
export function offsetFor(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    timeZoneName: 'longOffset'
  }).formatToParts(date);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  // Intl emits "GMT+08:00", "GMT-05:00", or bare "GMT" for UTC.
  const match = tzName.match(/GMT([+-]\d{1,2}(?::?\d{2})?)?/);
  if (!match || !match[1]) return '+00:00';
  const raw = match[1];
  if (raw.includes(':')) {
    const [sign, rest] = [raw[0], raw.slice(1)];
    const [h, m] = rest.split(':');
    return `${sign}${h.padStart(2, '0')}:${m}`;
  }
  const sign = raw[0];
  const digits = raw.slice(1);
  return `${sign}${digits.slice(0, 2).padStart(2, '0')}:${digits.slice(2).padEnd(2, '0')}`;
}

/** ISO-8601 timestamp in local time with explicit offset. */
export function nowISO(date: Date = new Date()): string {
  return date.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T') + offsetFor(date);
}

/**
 * A local day and time (`2026-11-20`, `08:00`) in `TIMEZONE` as an ISO time with that moment's offset.
 */
export function localISO(day: string, time: string): string {
  const local = `${day}T${time}:00`;
  // Read twice: the first offset, taken at that wall time in UTC, can sit on the other side of a DST change.
  const guess = offsetFor(new Date(`${local}Z`));
  return `${local}${offsetFor(new Date(`${local}${guess}`))}`;
}

/** YYYY-MM-DD in local time. */
export function todayDate(date: Date = new Date()): string {
  return date.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An ISO time as epoch milliseconds, 0 when it doesn't parse.
 */
export const isoMs = (iso: string): number => Date.parse(iso) || 0;

/** Days from `fromIso` to `toIso`; both YYYY-MM-DD. NaN-safe → 0. */
export const daysBetween = (fromIso: string, toIso: string): number => {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
};

/** The date `days` after `iso` (before it when negative); both YYYY-MM-DD. */
export const shiftDate = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** YYYY-MM-DD `n` days ago in local time. */
export function daysAgoDate(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', {
    timeZone: TIMEZONE
  });
}

/** HH:MM in local time (24-hour, colon-separated). */
export function nowTime(date: Date = new Date()): string {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE
  });
}

/** HHMM in local time (24-hour, no separator). Useful as a filename component. */
export function nowTimeCompact(date: Date = new Date()): string {
  return nowTime(date).replace(':', '');
}

/** `Nh` / `Nd` / `Nw` / `Nm` lookback → RFC3339 start time. */
export const sinceToStartTime = (since: string, now: Date = new Date()): string => {
  const match = /^(\d+)([hdwm])$/.exec(since);
  if (!match) throw new Error('Invalid `since` — use Nh / Nd / Nw / Nm (hours/days/weeks/months).');
  const hoursPerUnit = { h: 1, d: 24, w: 24 * 7, m: 24 * 30 } as const;
  const hours = Number(match[1]) * hoursPerUnit[match[2] as keyof typeof hoursPerUnit];
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
};

const LATER_HOUR = '08:00';

/**
 * The next 08:00 in the home's timezone, as an ISO time with that day's offset.
 */
export const nextMorning = (now: Date): string => {
  const today = todayDate(now);
  return localISO(nowTime(now) < LATER_HOUR ? today : shiftDate(today, 1), LATER_HOUR);
};
