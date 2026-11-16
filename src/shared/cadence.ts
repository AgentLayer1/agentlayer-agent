import { FILES } from '@/config';
import { nowISO } from '@/shared/date';
import { isRecord } from '@/shared/json-block';
import { writeJsonAtomic } from '@/shared/utils';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The `cadence.json` watermarks runtime surfaces read. The goals keys belong to the sync skill's
 * cadence script and survive every write here.
 */
export interface Cadence {
  /** `pending` from init until the first session's welcome, then the date it ran. */
  welcome?: string;
  /** ISO timestamp of the last sync, which ages in hours on the dashboard and days in the sync notice. */
  sync?: string;
}

// Whole, not field by field: the goals keys this module doesn't name ride through `stampCadence`.
export const readCadence = (): Cadence => {
  try {
    const data: unknown = JSON.parse(readFileSync(FILES.CADENCE, 'utf-8'));
    return isRecord(data) ? (data as Cadence) : {};
  } catch {
    return {};
  }
};

/** Set one watermark. A file that won't parse is left for the operator, never replaced, so no watermark is lost. */
export const stampCadence = (key: string, value: string): void => {
  const current = (() => {
    if (!existsSync(FILES.CADENCE)) {
      return {};
    }
    try {
      const data: unknown = JSON.parse(readFileSync(FILES.CADENCE, 'utf-8'));
      if (isRecord(data)) {
        return data;
      }
    } catch {
      // reported below
    }
    throw new Error(`${FILES.CADENCE} is not valid JSON; fix or remove it, then try again.`);
  })();
  writeJsonAtomic(FILES.CADENCE, { ...current, [key]: value });
};

export const stampSync = (): void => stampCadence('sync', nowISO());
