import { describe, expect, test } from 'bun:test';
import { parseGoal, parseGoals } from './goals';

const TASKS = `# Tasks

<!-- GOALS:START -->
## Daily Goals

_No daily goals set yet — run \`goals day\` to set today's._

## Weekly Goals — Week of Monday, 2026-11-02

1. acme-app: the export in customers' hands (ac-101) — two customers open the files
2. A goal with no dash

_Set Monday for a full week._

## Monthly Goals

_November 2026 · set 2026-11-01_

1. **Invoices go out on their own** _(success: by 11-30 no manual step, (ac-102) included)_ · added 11-05: the notes ride along
2. **A headline alone**

_Not doing in November: the redesign._

## Yearly Goals

_2026 theme: Make the shop run itself_

- **Q3** ✅ — 🧾 Checkout rebuilt
- **Q3** ↪ — unplanned; the shop stayed open
- **Q4** — 🧾 Invoices without hands _(check: by 12-31 none by hand)_
- **Q1 2027** — 🌱 Spring launch _(check: by 03-31 it sells)_
<!-- GOALS:END -->

## Active (0)
`;

describe('parseGoals', () => {
  const blocks = parseGoals(TASKS);

  test('one block per horizon in file order, with its date or month, a placeholder line dropped', () => {
    expect(blocks.map(({ horizon, date, caption }) => [horizon, date, caption])).toEqual([
      ['day', '', ''],
      ['week', '2026-11-02', ''],
      ['month', '', 'November 2026'],
      ['year', '', '']
    ]);
    expect(blocks[0]).toMatchObject({ theme: null, goals: [], notes: [] });
  });

  test('a weekly goal’s text after its dash is its check', () => {
    expect(blocks[1]?.goals).toEqual([
      {
        label: '',
        mark: '',
        title: "acme-app: the export in customers' hands (ac-101)",
        check: 'two customers open the files',
        detail: ''
      },
      { label: '', mark: '', title: 'A goal with no dash', check: '', detail: '' }
    ]);
    expect(blocks[1]?.notes).toEqual(['Set Monday for a full week.']);
  });

  test('a monthly goal’s bold headline, its success clause and the note after it come apart', () => {
    expect(blocks[2]?.notes, 'the intro’s other facts, then the lines after the goals').toEqual([
      'set 2026-11-01',
      'Not doing in November: the redesign.'
    ]);
    expect(blocks[2]?.goals).toEqual([
      {
        label: '',
        mark: '',
        title: 'Invoices go out on their own',
        check: 'by 11-30 no manual step, (ac-102) included',
        detail: 'added 11-05: the notes ride along'
      },
      { label: '', mark: '', title: 'A headline alone', check: '', detail: '' }
    ]);
  });

  test('a yearly goal keeps its quarter and score apart from its headline', () => {
    expect(blocks[3]).toMatchObject({ theme: { label: '2026 theme', text: 'Make the shop run itself' }, notes: [] });
    expect(blocks[3]?.goals.map(({ label, mark, title, check }) => [label, mark, title, check])).toEqual([
      ['Q3', '✅', '🧾 Checkout rebuilt', ''],
      ['Q3', '↪', 'unplanned; the shop stayed open', ''],
      ['Q4', '', '🧾 Invoices without hands', 'by 12-31 none by hand'],
      ['Q1 2027', '', '🌱 Spring launch', 'by 03-31 it sells']
    ]);
  });

  test('a file without the goal markers has no goals', () => {
    expect(parseGoals('## Weekly Goals\n\n1. Outside the markers\n')).toEqual([]);
  });
});

test('bold on part of a line is emphasis, not the headline', () => {
  expect(parseGoal('**Launch** the billing cutover')).toMatchObject({
    title: 'Launch the billing cutover',
    detail: ''
  });
});

test('a goal line with markdown reads as plain text', () => {
  expect(parseGoal('**Ship [the export](https://example.com)** _(success: `curl` works)_')).toEqual({
    label: '',
    mark: '',
    title: 'Ship the export',
    check: 'curl works',
    detail: ''
  });
});
