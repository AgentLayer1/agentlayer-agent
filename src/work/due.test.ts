import { expect, test } from 'bun:test';
import { daysUntil, dueBucket, mondayIndex, shortDate, toneOf } from './due';

test('a due date falls on the agenda in the same buckets on the dashboard and the sidebar', () => {
  const buckets = [
    '2026-11-08',
    '2026-11-09',
    '2026-11-16',
    '2026-11-17',
    '2026-12-09',
    '2026-12-10',
    '',
    'someday'
  ].map((due) => dueBucket(due, '2026-11-09'));
  expect(buckets).toEqual(['overdue', 'today', 'week', 'month', 'month', 'later', 'someday', 'someday']);
});

test('a date is overdue before today, soon within a week, later after', () => {
  expect([-1, 0, 7, 8].map(toneOf)).toEqual(['overdue', 'soon', 'soon', 'later']);
  expect(daysUntil('2026-04-01', '2026-03-28')).toBe(4);
  expect(daysUntil('', '2026-03-28')).toBeNull();
});

test('a date reads as its day and month, its weekday on request, and its place in a Monday-first week', () => {
  expect(shortDate('2026-11-09')).toBe('9 Nov');
  expect(shortDate('2026-11-09', { weekday: true })).toBe('Mon 9 Nov');
  expect(mondayIndex('2026-11-09')).toBe(0);
  expect(mondayIndex('2026-11-15')).toBe(6);
  expect([shortDate('not a date'), mondayIndex('')]).toEqual([null, null]);
});
