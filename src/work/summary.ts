import { localISO } from '@/shared/date';
import { markerBody } from './goals';
import type { WorkTasksSummary } from './model';

export const SUMMARY_MARKER_START = '<!-- SUMMARY:START -->';
export const SUMMARY_MARKER_END = '<!-- SUMMARY:END -->';

const WRITTEN = /^_Written (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?: ([+-]\d{2}):?(\d{2}))?(?: by .+)?_$/;

const writtenAt = ([, day, time, hours, minutes]: RegExpExecArray): string =>
  day && time && hours && minutes ? `${day}T${time}:00${hours}:${minutes}` : localISO(day ?? '', time ?? '');

/**
 * The summary of the tasks between TASKS.md's summary markers, and when it was written; none when the block is
 * missing, holds only its placeholder, or has no written line.
 */
export const parseTasksSummary = (markdown: string): WorkTasksSummary | null => {
  const lines = markerBody(markdown, SUMMARY_MARKER_START, SUMMARY_MARKER_END)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const written = lines.map((line) => WRITTEN.exec(line)).find((match) => match !== null);
  const text = lines.filter((line) => !/^_.*_$/.test(line)).join(' ');
  return written && text ? { text, writtenAt: writtenAt(written) } : null;
};
