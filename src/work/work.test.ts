import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILES, FOLDERS } from '@/config';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';
import { DEFAULT_AGENT_COLORS } from '@/shared/persona';
import { serializeTask } from '@/tasks/schema';
import type { TaskFrontmatter } from '@/tasks/types';
import { buildWork } from './build';
import { WORK_SCHEMA, type Work, type WorkTask } from './model';
import { readWork, writeWork } from './store';
import { taskOrder } from './order';
import {
  byLastUpdate,
  closedSince,
  isDueSoon,
  isOverdue,
  isStale,
  lastUpdate,
  projectLoads,
  queue,
  touchedRecently,
  withStatus
} from './views';

const previousHome = process.env.AGENT_HOME;
let home = '';

const writeTask = (folder: string, file: string, fields: Partial<TaskFrontmatter>, thread = 0) => {
  const frontmatter: TaskFrontmatter = {
    schema: 1,
    id: '',
    title: '',
    type: 'task',
    status: 'open',
    priority: 'P2',
    project: 'acme',
    assignee: [],
    labels: [],
    created: '2026-11-01',
    updated: '2026-11-01',
    due: '',
    horizon: '',
    depends_on: [],
    blocked_by: '',
    parent: '',
    issue: '',
    closed: '',
    ...fields
  };
  const entries = Array.from({ length: thread }, (_unused, index) => ({
    type: 'info' as const,
    author: 'Ada',
    timestamp: `2026-11-0${index + 1} 09:00`,
    message: `Note ${index + 1}`
  }));
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, file),
    serializeTask({ frontmatter, description: 'Why.', checklist: [], thread: entries, filePath: join(folder, file) })
  );
};

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'work-home-'));
  mkdirSync(join(home, RUNTIME_DIR), { recursive: true });
  writeFileSync(join(home, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
  process.env.AGENT_HOME = home;
  writeFileSync(FILES.IDENTITY, '# Identity\n\n- **Name:** Nova\n- **Emoji:** 🦉\n');
  const acme = join(FOLDERS.PROJECTS, 'acme');
  mkdirSync(acme, { recursive: true });
  writeFileSync(
    join(FOLDERS.PROJECTS, 'acme', 'README.md'),
    '---\nhue: 210\n---\n# Acme\n\nThe **acme** storefront.\n'
  );
  writeTask(
    join(acme, 'tasks'),
    'ac-002-ship.md',
    {
      id: 'ac-002',
      title: 'Ship the invoice export',
      status: 'active',
      priority: 'P1',
      due: '2026-11-08',
      updated: '2026-11-09'
    },
    2
  );
  writeTask(join(acme, 'tasks'), 'ac-001-fix.md', {
    id: 'ac-001',
    title: 'Fix the checkout total',
    priority: 'P0',
    due: '2026-11-12'
  });
  writeTask(join(acme, 'tasks'), 'ac-003-done.md', {
    id: 'ac-003',
    title: 'Pick a font',
    status: 'done',
    closed: '2026-11-05'
  });
  writeTask(join(acme, 'tasks'), 'ac-004-elsewhere.md', { id: 'ac-004', title: 'Name the shop', project: 'garden' });
  writeTask(join(acme, 'tasks', 'archive'), 'ac-000-old.md', {
    id: 'ac-000',
    title: 'Old work',
    status: 'done',
    closed: '2026-10-01'
  });
  mkdirSync(join(FOLDERS.PROJECTS, 'quiet', 'tasks'), { recursive: true });
  writeFileSync(join(FOLDERS.PROJECTS, 'quiet', 'tasks', 'qu-001-broken.md'), '  ---\nid: qu-001\n');
  writeFileSync(join(FOLDERS.PROJECTS, 'quiet', 'roadmap.html'), '<html></html>');
  mkdirSync(join(FOLDERS.REPORTS, 'plans'), { recursive: true });
  writeFileSync(join(FOLDERS.REPORTS, 'plans', '2026-11-08-0900-launch.md'), '# Launch plan\n');
  writeFileSync(join(FOLDERS.REPORTS, 'plans', 'loose-notes.md'), '---\ntitle: "Loose notes"\n---\n');
  const looseDay = new Date('2026-11-01T12:00:00Z');
  utimesSync(join(FOLDERS.REPORTS, 'plans', 'loose-notes.md'), looseDay, looseDay);
  utimesSync(join(FOLDERS.REPORTS, 'plans', '2026-11-08-0900-launch.md'), looseDay, looseDay);
  mkdirSync(join(FOLDERS.REPORTS, 'reviews'), { recursive: true });
  writeFileSync(join(FOLDERS.REPORTS, 'reviews', '2026-11-02-1000-audit.md'), '# Audit\n');
  const editedDay = new Date('2026-11-10T12:00:00Z');
  utimesSync(join(FOLDERS.REPORTS, 'reviews', '2026-11-02-1000-audit.md'), editedDay, editedDay);
  writeFileSync(
    FILES.REPORTS_INDEX,
    '# Reports\n\n## 2026-11-09\n\n- 08:30 · [Morning brief \\[draft\\]](briefings/2026-11-09-0830-morning.md) · `briefing` · 🟠 findings\n\n## 2026-11-02\n\n- 10:00 · [Audit](reviews/2026-11-02-1000-audit.md) · `engineer`\n'
  );
  writeFileSync(FILES.REPORTS_PINNED, '# Pinned\n\n- 🗺️ [Launch plan](plans/2026-11-08-0900-launch.md)\n');
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  process.env.AGENT_HOME = previousHome;
});

const ids = (tasks: readonly WorkTask[]) => tasks.map((task) => task.id);

describe('buildWork', () => {
  test('reads every task file once, archived ones flagged, ordered by path', () => {
    const work = buildWork();
    expect(work.schema).toBe(WORK_SCHEMA);
    expect(work.agent).toEqual({ name: 'Nova', emoji: '🦉', colors: DEFAULT_AGENT_COLORS });
    expect(work.roadmap).toBe('');
    expect(work.tasks.map((task) => [task.id, task.archived])).toEqual([
      ['ac-001', false],
      ['ac-002', false],
      ['ac-003', false],
      ['ac-004', false],
      ['ac-000', true]
    ]);
    expect(work.tasks[1]).toMatchObject({ comments: 2, path: join('projects', 'acme', 'tasks', 'ac-002-ship.md') });
    expect(work.malformed, 'a file that does not parse is named, not dropped').toEqual([
      join('projects', 'quiet', 'tasks', 'qu-001-broken.md')
    ]);
  });

  test('a project per folder plus any a task names, each with its README line, hue and pages', () => {
    const work = buildWork();
    expect(work.projects.map((project) => project.slug)).toEqual(['acme', 'garden', 'quiet']);
    expect(work.projects[0]).toMatchObject({ hue: 210, description: 'The acme storefront.', roadmap: '' });
    expect(work.projects[2]?.roadmap).toBe(join('projects', 'quiet', 'roadmap.html'));
  });

  test('reports from the index and unindexed files, newest filed first, and the live home pins', () => {
    const work = buildWork();
    expect(work.reports.map((report) => [report.date, report.title, report.path, report.skill, report.status])).toEqual(
      [
        [
          '2026-11-09',
          'Morning brief [draft]',
          join('reports', 'briefings', '2026-11-09-0830-morning.md'),
          'briefing',
          'findings'
        ],
        ['2026-11-08', 'Launch plan', join('reports', 'plans', '2026-11-08-0900-launch.md'), '', ''],
        ['2026-11-02', 'Audit', join('reports', 'reviews', '2026-11-02-1000-audit.md'), 'engineer', ''],
        ['2026-11-01', 'Loose notes', join('reports', 'plans', 'loose-notes.md'), '', '']
      ]
    );
    expect(work.pins).toEqual([
      { title: 'Launch plan', icon: '🗺️', path: join('reports', 'plans', '2026-11-08-0900-launch.md') }
    ]);
  });

  test('the same files give the same model', () => {
    expect(JSON.stringify(buildWork())).toBe(JSON.stringify(buildWork()));
  });
});

describe('the store', () => {
  test('writes only when the model changed, and reads back what it wrote', () => {
    const work = buildWork();
    writeWork(work);
    const written = statSync(FILES.WORK).mtimeMs;
    Bun.sleepSync(5);
    expect(writeWork(work)).toBe(false);
    expect(statSync(FILES.WORK).mtimeMs).toBe(written);
    expect(readWork()).toEqual(work);
    expect(writeWork({ ...work, agent: { ...work.agent, name: 'Nova II' } })).toBe(true);
  });

  test('a file of another version, or one that does not parse, reads as none', () => {
    writeFileSync(FILES.WORK, JSON.stringify({ ...buildWork(), schema: WORK_SCHEMA + 1 }));
    expect(readWork()).toBeNull();
    writeFileSync(FILES.WORK, '{"schema":');
    expect(readWork()).toBeNull();
  });
});

describe('views', () => {
  test('a report lists under its last update: the filed moment, or a later edit to its file', () => {
    const reports = buildWork().reports;
    expect(byLastUpdate(reports).map((report) => [lastUpdate(report).date, report.title])).toEqual([
      ['2026-11-10', 'Audit'],
      ['2026-11-09', 'Morning brief [draft]'],
      ['2026-11-08', 'Launch plan'],
      ['2026-11-01', 'Loose notes']
    ]);
  });

  const task = { status: 'open', due: '2026-11-08', updated: '2026-11-01' };

  test('overdue, due soon and stale read against the day they are given', () => {
    expect(isOverdue(task, '2026-11-09')).toBe(true);
    expect(isOverdue(task, '2026-11-08')).toBe(false);
    expect(isDueSoon(task, '2026-11-08')).toBe(true);
    expect(isDueSoon(task, '2026-10-24')).toBe(false);
    expect(isStale(task, '2026-11-09')).toBe(true);
    expect(isStale(task, '2026-11-08')).toBe(false);
    expect(isOverdue({ ...task, status: 'done' }, '2026-11-09')).toBe(false);
  });

  test('recently closed tasks include archived ones, from the day given', () => {
    const work = buildWork();
    expect(ids(closedSince(work, '2026-10-01'))).toEqual(['ac-003', 'ac-000']);
    expect(ids(closedSince(work, '2026-10-02'))).toEqual(['ac-003']);
  });

  test('recently updated tasks and tasks by status come from those in place only', () => {
    const work = buildWork();
    expect(ids(touchedRecently(work, '2026-11-10'))).toEqual(['ac-002']);
    expect(ids(withStatus(work, 'active', 'done'))).toEqual(['ac-002', 'ac-003']);
  });

  test('tasks order by priority, then due date with undated last, then the most recently updated', () => {
    const ranked = (priority: string, due: string, updated: string) => ({ priority, due, updated });
    const odd = ranked('urgent', '2026-11-01', '2026-11-09');
    const older = ranked('P1', '', '2026-11-01');
    const newer = ranked('P1', '', '2026-11-08');
    const dated = ranked('P1', '2026-11-20', '2026-10-01');
    const first = ranked('P0', '', '2026-10-01');
    expect([odd, older, newer, dated, first].toSorted(taskOrder)).toEqual([first, dated, newer, older, odd]);
  });

  test('the queue is the live tasks by priority, then due date', () => {
    expect(ids(queue(buildWork()))).toEqual(['ac-001', 'ac-002', 'ac-004']);
  });

  test('each project is counted from its tasks, archived ones as done, most recently touched first', () => {
    const loads = projectLoads(buildWork());
    expect(loads.map((load) => load.project)).toEqual(['acme', 'garden', 'quiet']);
    expect(loads[0]).toMatchObject({ open: 1, active: 1, blocked: 0, total: 2, done: 2, updatedAt: '2026-11-09' });
    expect(loads[2]).toMatchObject({ total: 0, done: 0, updatedAt: '' });
  });
});

test('a model that holds nothing for a home with no projects', () => {
  const empty: Work = {
    schema: WORK_SCHEMA,
    agent: { name: 'Scout', emoji: '', colors: DEFAULT_AGENT_COLORS },
    roadmap: '',
    projects: [],
    tasks: [],
    reports: [],
    pins: [],
    goals: [],
    tasksSummary: null,
    malformed: []
  };
  expect(projectLoads(empty)).toEqual([]);
  expect(queue(empty)).toEqual([]);
});
