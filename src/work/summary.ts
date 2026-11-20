import { resolve } from 'node:path';
import { FOLDERS } from '@/config';
import { localISO } from '@/shared/date';
import { readTextIfExists } from '@/shared/text';
import type { WorkTasksSummary } from './model';

export const SUMMARY_MARKER_START = '<!-- SUMMARY:START -->';
export const SUMMARY_MARKER_END = '<!-- SUMMARY:END -->';

const WRITTEN = /^_Written (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: by .+)?_$/;

/**
 * The summary of the tasks between TASKS.md's summary markers, and when it was written; none when the block is
 * missing, holds only its placeholder, or has no written line.
 */
export const parseTasksSummary = (markdown: string): WorkTasksSummary | null => {
  const body = markdown.split(SUMMARY_MARKER_START)[1]?.split(SUMMARY_MARKER_END)[0] ?? '';
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const written = lines.map((line) => WRITTEN.exec(line)).find((match) => match !== null);
  const text = lines.filter((line) => !WRITTEN.test(line) && !/^_.*_$/.test(line)).join(' ');
  return written?.[1] && written[2] && text ? { text, writtenAt: localISO(written[1], written[2]) } : null;
};

export const readTasksSummary = (): WorkTasksSummary | null =>
  parseTasksSummary(readTextIfExists(resolve(FOLDERS.PROJECTS, 'TASKS.md')));
