import { describe, expect, test } from 'bun:test';
import { digest, parseEntries } from './feedback-digest';

const entry = (header: string, body: string): string => `\n\n---\n\n${header}\n\n${body}\n`;
const filler = (index: number): string =>
  entry(
    `## 2026-10-${String(index + 1).padStart(2, '0')}T10:00:00+08:00 — note ${index}`,
    `Unrelated topic number ${index} about calendars, invoices and travel plans.`
  );

const LOG = [
  '# Feedback\n',
  entry('## 2026-04-23T10:38:06+08:00 · correction', '> no, search by name\n\nScope: the account search.'),
  ...Array.from({ length: 20 }, (_unused, index) => filler(index)),
  entry(
    '## 2026-10-25T09:00:00+08:00 — graduated: Scratch files get a mktemp name',
    'Rule: "Scratch files get a mktemp name, never a hand-picked one, and are never found again by a glob." Now lives in AGENTS.md#Platform.'
  ),
  entry(
    '## 2026-11-02 — correction [11111111-aaaa-bbbb-cccc-000000000001:0123456789abcdef]',
    '> a hand-picked scratch name again, found again by a glob\n\nScope: scratch files.'
  ),
  entry('## 2026-11-03T08:00:00+08:00 — preference', 'Calendars stay out of the invoices folder.')
].join('');

describe('feedback digest', () => {
  test('every header form is an entry: the old dot form, the dash form and a keyed one', () => {
    const entries = parseEntries(LOG);
    expect(entries).toHaveLength(24);
    expect(entries[0]).toMatchObject({ date: '2026-04-23', label: 'correction', session: null });
    expect(entries.at(-2)).toMatchObject({
      date: '2026-11-02',
      label: 'correction',
      session: '11111111-aaaa-bbbb-cccc-000000000001'
    });
  });

  test('only entries after the watermark are listed, each by its first line', () => {
    const { fresh, total } = digest(LOG, '2026-11-01');
    expect(total).toBe(24);
    expect(fresh.entries.map((row) => row.date)).toEqual(['2026-11-02', '2026-11-03']);
    expect(fresh.entries[0].line).toBe('a hand-picked scratch name again, found again by a glob');
  });

  test("a later entry sharing a graduated rule's words is a lead; an unrelated one is not", () => {
    const [marker] = digest(LOG, null).markers;
    expect(marker.theme).toBe('Scratch files get a mktemp name');
    expect(marker.later.map((row) => row.date)).toEqual(['2026-11-02']);
  });
});
