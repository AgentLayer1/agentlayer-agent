import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILES, FOLDERS } from '@/config';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';
import { serializeTask } from '@/tasks/schema';
import { writeDashboardSafe } from '@/tasks/dashboard';
import { rebuildDashboards, writeDashboardHtml } from './html';

const previousHome = process.env.AGENT_HOME;
let home = '';

const writeTitle = (title: string) => {
  const folder = join(FOLDERS.PROJECTS, 'acme', 'tasks');
  const filePath = join(folder, 'ac-001-ship.md');
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    filePath,
    serializeTask({
      frontmatter: {
        schema: 1,
        id: 'ac-001',
        title,
        type: 'task',
        status: 'active',
        priority: 'P1',
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
        closed: ''
      },
      description: 'Why.',
      checklist: [],
      thread: [],
      filePath
    })
  );
};

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'html-write-home-'));
  mkdirSync(join(home, RUNTIME_DIR), { recursive: true });
  writeFileSync(join(home, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
  process.env.AGENT_HOME = home;
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  process.env.AGENT_HOME = previousHome;
});

test('the rebuild a task change queues never lands over a later refresh with older files', async () => {
  writeTitle('Before the edit');
  writeDashboardSafe();
  writeTitle('After the edit');
  await rebuildDashboards();
  // The queued rebuild has no handle to await; give it time to land if it is going to land late.
  await Bun.sleep(750);
  expect(readFileSync(FILES.DASHBOARD, 'utf8')).toContain('After the edit');
  expect(readFileSync(FILES.WORK, 'utf8')).toContain('After the edit');
});

test('requests made before a write starts share it, since it reads the files after all of them', async () => {
  const first = writeDashboardHtml();
  expect(writeDashboardHtml()).toBe(first);
  await first;
});
