import { describe, expect, test } from 'bun:test';
import type { WorkTask } from '@/work/model';
import { formatDashboard } from './dashboard';

const task = (id: string, project: string, updated: string): WorkTask => ({
  id,
  title: `Title of ${id}`,
  project,
  status: 'open',
  priority: 'P2',
  due: '',
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

const staleSection = (stale: WorkTask[]): string => {
  const markdown = formatDashboard({ active: stale, blocked: [], overdue: [], stale, closedRecent: [] }, '');
  return markdown.slice(markdown.indexOf('## Stale'), markdown.indexOf('## Recently Closed')).trim();
};

describe('formatDashboard Stale section', () => {
  test('lists ids per project, oldest update first, without repeating titles', () => {
    const section = staleSection([
      task('lo-002', 'life-os', '2026-07-24'),
      task('al-017', 'agent-layer', '2026-06-29'),
      task('lo-001', 'life-os', '2026-05-03')
    ]);
    expect(section).toBe(
      '## Stale (3)\n\n- **agent-layer**: al-017 (06-29)\n- **life-os**: lo-001 (05-03) · lo-002 (07-24)'
    );
  });

  test('an empty section says none', () => {
    expect(staleSection([])).toBe('## Stale (0)\n\n_(none)_');
  });
});

describe('formatDashboard task lines', () => {
  test('a handed-off task links its issue after the title', () => {
    const handedOff = task('lo-003', 'life-os', '2026-07-24');
    const linked = { ...handedOff, issue: 'https://github.com/acme/widgets/issues/42' };
    const markdown = formatDashboard({ active: [linked], blocked: [], overdue: [], stale: [], closedRecent: [] }, '');
    expect(markdown).toContain(
      '**Title of lo-003** ↗ [acme/widgets#42](https://github.com/acme/widgets/issues/42) _(priority: P2'
    );
  });
});

describe('formatDashboard blocked lines', () => {
  test('name blocked_by and depends_on as the task file does', () => {
    const blocked = {
      ...task('lo-004', 'life-os', '2026-07-24'),
      blockedBy: 'Waiting on the vendor',
      dependsOn: ['lo-001']
    };
    const markdown = formatDashboard({ active: [], blocked: [blocked], overdue: [], stale: [], closedRecent: [] }, '');
    expect(markdown).toContain(
      '_(project: life-os · priority: P2 · blocked_by: Waiting on the vendor · depends_on: lo-001)_'
    );
  });
});
