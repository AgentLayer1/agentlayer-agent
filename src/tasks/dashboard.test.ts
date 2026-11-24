import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '@/config';
import type { WorkTask } from '@/work/model';
import { parseGoals } from '@/work/goals';
import { parseTasksSummary } from '@/work/summary';
import { formatDashboard, writeDashboard } from './dashboard';

const task = (id: string, project: string, updated: string): WorkTask => ({
  id,
  title: `Title of ${id}`,
  project,
  status: 'open',
  priority: 'P2',
  due: '',
  horizon: '',
  updated,
  closed: '',
  assignee: [],
  dependsOn: [],
  blockedBy: '',
  issue: '',
  comments: 0,
  archived: false,
  path: `projects/${project}/tasks/${id}-slug.md`
});

const shown = (parts: Partial<Parameters<typeof formatDashboard>[0]>): string =>
  formatDashboard({ active: [], blocked: [], overdue: [], stale: [], closedRecent: [], ...parts }, '');

const section = (markdown: string, heading: string): string => {
  const from = markdown.indexOf(heading);
  const next = markdown.indexOf('\n## ', from + 1);
  return markdown.slice(from, next === -1 ? undefined : next).trim();
};

describe('formatDashboard lists the top priorities and counts the rest', () => {
  const top = { ...task('lo-001', 'life-os', '2026-07-24'), priority: 'P1' };
  const low = task('lo-002', 'life-os', '2026-07-24');
  const lower = { ...task('al-003', 'agent-layer', '2026-07-24'), priority: 'P3' };

  test('only P0 and P1 tasks get a line', () => {
    const markdown = shown({ active: [top, low, lower] });
    expect(section(markdown, '## Priorities')).toBe(
      '## Priorities (1)\n\n### life-os\n- [[lo-001-slug|lo-001]] **Title of lo-001** _(priority: P1 · status: open)_'
    );
    expect(markdown).not.toContain('Title of lo-002');
  });

  test('every project is counted by priority, with what it has blocked', () => {
    const waiting = { ...task('lo-004', 'life-os', '2026-07-24'), status: 'blocked' };
    const markdown = shown({ active: [top, low, lower], blocked: [waiting], stale: [low], closedRecent: [lower, low] });
    expect(section(markdown, '## Open by Project')).toBe(
      '## Open by Project (3)\n\n- **agent-layer**: 1 open · P3 1\n- **life-os**: 2 open · P1 1 · P2 1 · 1 blocked\n\n_1 stale · 2 closed in the last 14 days._'
    );
  });

  test('a blocked task below P1 is counted, not listed', () => {
    const waiting = { ...task('lo-004', 'life-os', '2026-07-24'), status: 'blocked', blockedBy: 'Waiting on the vendor' };
    expect(section(shown({ blocked: [waiting] }), '## Blocked')).toBe('## Blocked (1)\n\n_1 at lower priority._');
    const urgent = { ...waiting, id: 'lo-005', priority: 'P0' };
    const both = section(shown({ blocked: [urgent, waiting] }), '## Blocked');
    expect(both).toContain('**Title of lo-004**');
    expect(both.endsWith('_Plus 1 at lower priority._')).toBe(true);
  });

  test('a long title or blocker is cut, so one task never takes a paragraph', () => {
    const long = { ...top, title: 'x'.repeat(140), status: 'blocked', blockedBy: 'y'.repeat(140) };
    const markdown = shown({ blocked: [long] });
    expect(markdown).toContain(`**${'x'.repeat(99)}…**`);
    expect(markdown).toContain(`blocked_by: ${'y'.repeat(99)}…`);
  });

  test('empty sections say none', () => {
    const markdown = shown({});
    expect(section(markdown, '## Priorities')).toBe('## Priorities (0)\n\n_(none)_');
    expect(section(markdown, '## Blocked')).toBe('## Blocked (0)\n\n_(none)_');
  });
});

describe('formatDashboard task lines', () => {
  test('a handed-off task links its issue after the title', () => {
    const handedOff = task('lo-003', 'life-os', '2026-07-24');
    const linked = { ...handedOff, priority: 'P1', issue: 'https://github.com/acme/widgets/issues/42' };
    const markdown = formatDashboard({ active: [linked], blocked: [], overdue: [], stale: [], closedRecent: [] }, '');
    expect(markdown).toContain(
      '**Title of lo-003** ↗ [acme/widgets#42](https://github.com/acme/widgets/issues/42) _(priority: P1'
    );
  });
});

describe('formatDashboard blocked lines', () => {
  test('name blocked_by and depends_on as the task file does', () => {
    const blocked = {
      ...task('lo-004', 'life-os', '2026-07-24'),
      priority: 'P1',
      blockedBy: 'Waiting on the vendor',
      dependsOn: ['lo-001']
    };
    const markdown = formatDashboard({ active: [], blocked: [blocked], overdue: [], stale: [], closedRecent: [] }, '');
    expect(markdown).toContain(
      '_(project: life-os · priority: P1 · blocked_by: Waiting on the vendor · depends_on: lo-001)_'
    );
  });
});

test('a rebuild keeps the goals and the summary blocks byte for byte, the summary under the goals', () => {
  const goals = '<!-- GOALS:START -->\n## Weekly Goals\n\n1. Ship the export\n<!-- GOALS:END -->';
  const summary = '<!-- SUMMARY:START -->\n## Tasks at a Glance\n\n_Written 2026-11-20 09:30 by sync_\n\nCheckout leads.\n<!-- SUMMARY:END -->';
  const file = join(FOLDERS.PROJECTS, 'TASKS.md');
  mkdirSync(FOLDERS.PROJECTS, { recursive: true });
  writeFileSync(file, `# old\n\n${summary}\n\n${goals}\n\n## Active (9)\n`);
  writeDashboard({ tasks: [], malformed: [] });
  const rebuilt = readFileSync(file, 'utf-8');
  expect(rebuilt).toContain(goals);
  expect(rebuilt).toContain(summary);
  expect(rebuilt.indexOf(goals)).toBeLessThan(rebuilt.indexOf(summary));
  expect(rebuilt.indexOf(summary)).toBeLessThan(rebuilt.indexOf('## Priorities (0)'));
  expect(parseGoals(rebuilt).map((block) => block.goals.length)).toEqual(parseGoals(goals).map((block) => block.goals.length));
  expect(parseTasksSummary(rebuilt)).toEqual(parseTasksSummary(summary));
});

test('a TASKS.md with no summary block gets the placeholder, which reads as no summary', () => {
  const file = join(FOLDERS.PROJECTS, 'TASKS.md');
  mkdirSync(FOLDERS.PROJECTS, { recursive: true });
  writeFileSync(file, '# old\n');
  writeDashboard({ tasks: [], malformed: [] });
  expect(readFileSync(file, 'utf-8')).toContain('_No summary yet. Sync writes one._');
});
