import { expect, test } from 'bun:test';
import { dueBucket, dueLabel } from './sidebar/due';

test('a due date reads as overdue, today, tomorrow, soon or later against today', () => {
  expect(dueLabel('2026-11-07', '2026-11-09')).toEqual({ text: 'overdue 2d', tone: 'overdue' });
  expect(dueLabel('2026-11-09', '2026-11-09')).toEqual({ text: 'due today', tone: 'soon' });
  expect(dueLabel('2026-11-10', '2026-11-09')).toEqual({ text: 'due tomorrow', tone: 'soon' });
  expect(dueLabel('2026-11-16', '2026-11-09')).toEqual({ text: 'due in 7d', tone: 'soon' });
  expect(dueLabel('2026-12-01', '2026-11-09')).toEqual({ text: 'due in 22d', tone: 'later' });
});

test('across a month and a daylight-saving change the count stays in whole days', () => {
  expect(dueLabel('2026-04-01', '2026-03-28')?.text).toBe('due in 4d');
});

test('no due date, or one that does not parse, gives no label', () => {
  expect(dueLabel('', '2026-11-09')).toBeNull();
  expect(dueLabel('someday', '2026-11-09')).toBeNull();
});

test('a due date falls on the agenda the way the dashboard groups it', () => {
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
