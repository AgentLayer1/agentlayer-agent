import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOLDERS } from '@/config';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';
import { appendThread, closeTask, createTask, updateTask } from './mutate';
import { findTaskById } from './scan';

const newTask = (extra: { parent?: string; checklist?: string[] } = {}) => {
  mkdirSync(join(FOLDERS.PROJECTS, 'acme', 'tasks'), { recursive: true });
  return createTask({
    project: 'acme',
    title: 'Ship the invoice export',
    description: 'Customers asked for CSV.',
    assignee: ['user'],
    ...extra
  });
};

const from = (content: string, heading: string) => content.slice(content.indexOf(heading));

describe('createTask', () => {
  test('refuses a project that is not a plain slug, so nothing is written outside projects/', () => {
    mkdirSync(join(FOLDERS.PROJECTS, '..', 'outside', 'tasks'), { recursive: true });
    expect(() => createTask({ project: '../outside', title: 'Escape', description: '', assignee: ['user'] })).toThrow(/Unknown project/);
  });
});

describe('task files that must survive a round trip', () => {
  test('a title or blocked_by with a line break keeps every other field', () => {
    const id = newTask().frontmatter.id;
    updateTask(id, { title: 'Fix A\n---\nmore', priority: 'P0', status: 'blocked', blocked_by: 'Waiting on vendor\n- then legal' });
    const task = findTaskById(id);
    expect(task?.frontmatter).toMatchObject({ title: 'Fix A\n---\nmore', priority: 'P0', project: 'acme', blocked_by: 'Waiting on vendor\n- then legal' });
  });

  test('a new description with a section heading is refused, like an update', () => {
    mkdirSync(join(FOLDERS.PROJECTS, 'acme', 'tasks'), { recursive: true });
    expect(() =>
      createTask({ project: 'acme', title: 'Headings', description: 'intro\n## Checklist\n- [x] fake', assignee: ['user'] })
    ).toThrow(/heading/);
  });

  test('a thread author with a space or symbol reads back', () => {
    const id = newTask().frontmatter.id;
    appendThread(id, 'Ada (operator)', 'first');
    appendThread(id, 'oppi', 'second');
    expect(findTaskById(id)?.thread.map((entry) => [entry.author, entry.message])).toEqual([
      ['Ada (operator)', 'first'],
      ['oppi', 'second']
    ]);
  });
});

describe('a collision prefix', () => {
  test('tasks under a digit-suffixed prefix are scanned like any other', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tasks-prefix-'));
    mkdirSync(join(home, RUNTIME_DIR), { recursive: true });
    writeFileSync(join(home, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
    const preload = process.env.AGENT_HOME;
    process.env.AGENT_HOME = home;
    try {
      ['home-server', 'home-stuff'].forEach((project) => mkdirSync(join(FOLDERS.PROJECTS, project, 'tasks'), { recursive: true }));
      const ids = ['home-server', 'home-stuff'].map(
        (project) => createTask({ project, title: 'First', description: '', assignee: ['user'] }).frontmatter.id
      );
      expect(ids).toEqual(['hs-001', 'hs2-001']);
      const { scanAllTasks } = await import('./scan');
      expect(scanAllTasks().map((task) => task.frontmatter.id).toSorted()).toEqual(['hs-001', 'hs2-001']);
    } finally {
      process.env.AGENT_HOME = preload;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('parent, depends_on and checklist', () => {
  test('create stores parent and checklist, update changes parent and depends_on', () => {
    const epic = newTask();
    const created = newTask({ parent: epic.frontmatter.id, checklist: ['Write the query', 'Add the button'] });
    const id = created.frontmatter.id;

    expect(findTaskById(id)?.frontmatter.parent).toBe(epic.frontmatter.id);
    expect(findTaskById(id)?.checklist).toEqual([
      { checked: false, text: 'Write the query' },
      { checked: false, text: 'Add the button' }
    ]);

    updateTask(id, { parent: '', depends_on: [epic.frontmatter.id] });
    expect(findTaskById(id)?.frontmatter.parent).toBe('');
    expect(findTaskById(id)?.frontmatter.depends_on).toEqual([epic.frontmatter.id]);
  });
});

describe('issue', () => {
  const url = 'https://github.com/acme/widgets/issues/42';

  test('a hand-off link is written, read back and cleared', () => {
    const id = newTask().frontmatter.id;
    expect(findTaskById(id)?.frontmatter.issue).toBe('');

    updateTask(id, { issue: url });
    expect(findTaskById(id)?.frontmatter.issue).toBe(url);

    updateTask(id, { issue: '' });
    expect(findTaskById(id)?.frontmatter.issue).toBe('');
  });

  test('anything but a GitHub issue URL is refused before the write', () => {
    const created = newTask();
    const before = readFileSync(created.filePath, 'utf-8');

    expect(() => updateTask(created.frontmatter.id, { issue: 'https://github.com/acme/widgets/pull/42' })).toThrow(
      'Not a GitHub issue URL'
    );
    expect(() => updateTask(created.frontmatter.id, { issue: 'acme/widgets#42' })).toThrow('Not a GitHub issue URL');
    expect(readFileSync(created.filePath, 'utf-8')).toBe(before);
  });

  test('a task file written before the field existed reads as not handed off', () => {
    const created = newTask();
    writeFileSync(created.filePath, readFileSync(created.filePath, 'utf-8').replace(/^issue:.*\n/m, ''));
    expect(findTaskById(created.frontmatter.id)?.frontmatter.issue).toBe('');
  });
});

describe('closeTask', () => {
  test('a blocked task closes as done', () => {
    const id = newTask().frontmatter.id;
    updateTask(id, { status: 'blocked' });

    closeTask(id);
    expect(findTaskById(id)?.frontmatter.status).toBe('done');
  });

  const backdateClosed = (id: string) => {
    const path = findTaskById(id)?.filePath ?? '';
    writeFileSync(path, readFileSync(path, 'utf-8').replace(/^closed: .*$/m, 'closed: 2026-01-05'));
  };

  test('closing a done task again keeps the date it was closed', () => {
    const id = newTask().frontmatter.id;
    closeTask(id);
    backdateClosed(id);

    closeTask(id);
    expect(findTaskById(id)?.frontmatter.closed).toBe('2026-01-05');
  });

  test('cancelling a cancelled task again keeps the date it was cancelled', () => {
    const id = newTask().frontmatter.id;
    updateTask(id, { status: 'cancelled' });
    backdateClosed(id);

    updateTask(id, { status: 'cancelled' });
    expect(findTaskById(id)?.frontmatter.closed).toBe('2026-01-05');
  });
});

describe('updateTask description', () => {
  test('replaces only the description; checklist and thread stay byte-for-byte', () => {
    const created = newTask({ checklist: ['Write the query'] });
    const id = created.frontmatter.id;
    appendThread(id, 'user', 'Ada wants it by Friday.', 'quote');
    const before = readFileSync(created.filePath, 'utf-8');

    updateTask(id, { priority: 'P1', description: 'Export invoices as CSV.\n\n### Scope\nAll invoices since 2020.' });

    const after = readFileSync(created.filePath, 'utf-8');
    expect(findTaskById(id)?.description).toBe('Export invoices as CSV.\n\n### Scope\nAll invoices since 2020.');
    expect(findTaskById(id)?.frontmatter.priority).toBe('P1');
    expect(from(after, '## Checklist')).toBe(from(before, '## Checklist'));
  });

  test('adds a missing Description section before the checklist', () => {
    const created = newTask({ checklist: ['Write the query'] });
    const raw = readFileSync(created.filePath, 'utf-8');
    writeFileSync(created.filePath, raw.replace('## Description\n\nCustomers asked for CSV.\n\n', ''));

    updateTask(created.frontmatter.id, { description: 'Restored.' });

    const task = findTaskById(created.frontmatter.id);
    expect(task?.description).toBe('Restored.');
    expect(task?.checklist).toEqual([{ checked: false, text: 'Write the query' }]);
  });

  test('a duplicated Description heading edits the one the parser reads', () => {
    const created = newTask();
    const raw = readFileSync(created.filePath, 'utf-8');
    writeFileSync(created.filePath, raw.replace('## Checklist', '## Description\n\nSecond copy.\n\n## Checklist'));

    updateTask(created.frontmatter.id, { description: 'Rewritten.' });

    expect(findTaskById(created.frontmatter.id)?.description).toBe('Rewritten.');
  });

  test('a refused description writes nothing, not even the other fields', () => {
    const created = newTask();
    const before = readFileSync(created.filePath, 'utf-8');

    expect(() =>
      updateTask(created.frontmatter.id, { priority: 'P0', description: 'Intro\n## Checklist\n- [ ] sneaky' })
    ).toThrow('heading');
    expect(readFileSync(created.filePath, 'utf-8')).toBe(before);
  });
});

describe('line endings', () => {
  test('a task file saved with CRLF comes back with LF only after an update and a thread entry', () => {
    const created = newTask();
    writeFileSync(created.filePath, readFileSync(created.filePath, 'utf-8').replace(/\n/g, '\r\n'));

    updateTask(created.frontmatter.id, { priority: 'P1' });
    appendThread(created.frontmatter.id, 'Ada', 'Picked up.');

    const content = readFileSync(created.filePath, 'utf-8');
    expect(content).not.toContain('\r');
    expect(findTaskById(created.frontmatter.id)?.frontmatter.priority).toBe('P1');
  });
});
