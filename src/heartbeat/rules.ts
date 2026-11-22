import { isoMs } from '@/shared/date';
import type { Heartbeat } from './ledger';

/**
 * The heartbeat's interval when none is set: inside the prompt cache's hour, so a wake reads the cache.
 */
export const DEFAULT_EVERY_MINUTES = 55;
/**
 * How long the brain may go without a sync or a refresh before the heartbeat refreshes it.
 */
export const REFRESH_EVERY_HOURS = 6;
const EVERY_RANGE = { min: 5, max: 24 * 60 } as const;

const DURATION = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/i;

/**
 * Minutes from `15m`, `15 mins`, `1h` or `90 minutes`, within 5 minutes and a day; an error saying why otherwise.
 */
export const parseEvery = (text: string): number | Error => {
  const match = DURATION.exec(text.trim());
  if (!match) {
    return new Error(`"${text}" isn't a duration like 15m, 15 mins, 1h or 90 minutes.`);
  }
  const amount = Number(match[1]);
  const minutes = /^h/i.test(match[2] ?? '') ? amount * 60 : amount;
  return minutes < EVERY_RANGE.min || minutes > EVERY_RANGE.max
    ? new Error(`Pick an interval between ${EVERY_RANGE.min} minutes and 24 hours.`)
    : minutes;
};

/**
 * The later of the last full sync and the last brain refresh, as an ISO time; '' when neither ever ran.
 */
export const lastRefreshed = (syncedAt = '', refreshedAt = ''): string =>
  isoMs(syncedAt) >= isoMs(refreshedAt) ? syncedAt : refreshedAt;

/**
 * Whether the heartbeat should refresh the brain: nothing has synced or refreshed it in the last `REFRESH_EVERY_HOURS`.
 */
export const refreshDue = (lastAt: string, now: Date): boolean =>
  !lastAt || now.getTime() - isoMs(lastAt) >= REFRESH_EVERY_HOURS * 60 * 60 * 1000;

/**
 * The heartbeat once `owner` leaves: none while it still holds it, so a session that exits never clears a newer one.
 */
export const released = (beat: Heartbeat | null, owner: string): Heartbeat | null =>
  beat?.owner === owner ? null : beat;
