import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NOVA } from '@/cmux/preview/fixture';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';
import type { WorkTask } from '@/work/model';
import { collectStatus, operatorGithubLogin } from './collect';

const withUserMd = <T>(body: string, fn: () => T): T => {
  const home = mkdtempSync(resolve(tmpdir(), 'collect-test-'));
  mkdirSync(resolve(home, RUNTIME_DIR), { recursive: true });
  writeFileSync(resolve(home, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
  writeFileSync(resolve(home, 'USER.md'), body);
  const priorHome = process.env.AGENT_HOME;
  process.env.AGENT_HOME = home;
  try {
    return fn();
  } finally {
    process.env.AGENT_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
  }
};

describe('operatorGithubLogin', () => {
  test('a note after the login is not part of it', () => {
    const md = "- **GitHub login:** octo-cat (the PR playbooks use it to tell my PRs from teammates')\n";
    expect(withUserMd(md, operatorGithubLogin)).toBe('octo-cat');
  });

  test('backticks and a leading @ are dropped', () => {
    expect(withUserMd('- **GitHub login:** `@octo-cat`\n', operatorGithubLogin)).toBe('octo-cat');
  });

  test('no field reads as empty', () => {
    expect(withUserMd('# About Ada\n', operatorGithubLogin)).toBe('');
  });
});

const task = (id: string, status: string, priority: string, due: string, updated: string): WorkTask => ({
  id,
  title: id,
  project: 'acme',
  status,
  priority,
  due,
  horizon: '',
  updated,
  closed: '',
  assignee: [],
  dependsOn: [],
  blockedBy: '',
  issue: '',
  comments: 0,
  archived: false,
  path: join('projects', 'acme', 'tasks', `${id}.md`)
});

test('the dashboard lists tasks by priority, then due date, then the most recently updated', async () => {
  const snapshot = await collectStatus({
    ...NOVA,
    tasks: [
      task('ac-001', 'active', 'P2', '', '2026-11-01'),
      task('ac-002', 'active', 'P1', '', '2026-11-02'),
      task('ac-003', 'active', 'P1', '', '2026-11-09'),
      task('ac-004', 'active', 'P1', '2099-12-01', '2026-10-01'),
      task('ac-005', 'open', 'P3', '2026-01-01', '2026-10-01'),
      task('ac-006', 'open', 'P1', '2026-02-01', '2026-10-01')
    ]
  });
  const ids = (tasks: { id: string }[]) => tasks.map((item) => item.id);
  expect(ids(snapshot.tasks.activeList)).toEqual(['ac-004', 'ac-003', 'ac-002', 'ac-001']);
  expect(ids(snapshot.tasks.overdueList)).toEqual(['ac-006', 'ac-005']);
});
