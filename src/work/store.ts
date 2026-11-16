import { FILES } from '@/config';
import { readText, readTextIfExists } from '@/shared/text';
import { writeFileAtomic } from '@/shared/utils';
import { WorkSchema, type Work } from './model';

const serialize = (work: Work): string => `${JSON.stringify(work, null, 2)}\n`;

/**
 * Writes the model to `.state/work.json` when it differs from what's there; returns whether it wrote.
 */
export const writeWork = (work: Work): boolean => {
  const text = serialize(work);
  if (readTextIfExists(FILES.WORK) === text) {
    return false;
  }
  writeFileAtomic(FILES.WORK, text);
  return true;
};

/**
 * The model last written, or null when there is none or it doesn't parse as this version.
 */
export const readWork = (): Work | null => {
  try {
    const parsed = WorkSchema.safeParse(JSON.parse(readText(FILES.WORK)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
