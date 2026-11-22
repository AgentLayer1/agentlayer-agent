import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { homeEntry } from './entry';
import { NOVA, NOVA_HOME } from './preview/fixture';
import { readRecentFiles, RECENT_LIMIT, type HomeFolders } from './recent';

const NOW = Date.UTC(2026, 10, 9, 2, 0);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'recent-home-'));
  dirs.push(dir);
  return dir;
};

// A home with its projects, reports and knowledge where init puts them.
const layout = (home: string): HomeFolders => ({
  home,
  projects: join(home, 'projects'),
  reports: join(home, 'reports'),
  knowledge: join(home, 'knowledge')
});

// Each file is written `ago` milliseconds before NOW, at a path below `root`.
const writeFiles = (root: string, files: Record<string, { ago: number; text?: string }>): void =>
  Object.entries(files).forEach(([path, { ago, text = '' }]) => {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
    const at = (NOW - ago) / 1000;
    utimesSync(absolute, at, at);
  });

const homeWith = (files: Record<string, { ago: number; text?: string }>): HomeFolders => {
  const home = tempDir();
  writeFiles(home, files);
  return layout(home);
};

const kept = [
  join('projects', 'acme-app', 'tasks', 'ac-101.md'),
  join('projects', 'acme-app', 'tasks', 'archive', 'ac-090.md'),
  join('projects', 'acme-app', 'README.md'),
  join('projects', 'acme-app', 'roadmap.html'),
  join('projects', 'acme-app', 'handoff', 'notes.pdf'),
  join('reports', 'plans', 'pricing.md'),
  join('reports', 'notes', '2026-11-09-0900-note.md'),
  join('knowledge', 'user', 'profile.md'),
  join('knowledge', 'concepts', 'pricing.md'),
  join('knowledge', 'memory', 'index.md'),
  join('knowledge', 'memory', '2026-11-08.md'),
  join('extensions', 'skills', 'briefing.md'),
  'USER.md',
  'roadmap.html'
];

const left = [
  join('.state', 'work.json'),
  join('.state', 'logs', 'app.md'),
  join('.claude', 'rules', 'xcode.md'),
  join('projects', '.obsidian', 'notes.md'),
  join('projects', 'TASKS.md'),
  join('projects', 'acme-app', 'node_modules', 'pkg', 'README.md'),
  join('projects', 'acme-app', 'data.json'),
  join('reports', 'index.md'),
  join('reports', 'pinned.md'),
  join('reports', 'captures', 'shot.png'),
  join('knowledge', 'index.md'),
  join('knowledge', 'raw', 'sessions', '2026-11-09.md'),
  join('knowledge', 'raw', 'user', 'feedback.md'),
  join('knowledge', 'memory', 'archive', 'decisions-2026-10.md'),
  join('knowledge', 'user', 'assets', 'avatar.jpg'),
  join('extensions', 'skills', 'helper.ts'),
  join('scripts', 'run.md'),
  join('assets', 'avatar.png'),
  'dashboard.html',
  'notes.md'
];

test('the scan keeps the operator’s documents, newest first, and leaves out state, raw inputs and generated pages', () => {
  const all = [...kept, ...left];
  const home = homeWith(Object.fromEntries(all.map((path, index) => [path, { ago: index * MINUTE }])));
  const found = readRecentFiles(home, NOW).map((file) => file.path);
  expect(found).toEqual(kept);
});

test('a note and its page are one row that opens the page, dated by the newer of the two', () => {
  const md = join('projects', 'acme-app', 'helpdesk.md');
  const html = join('projects', 'acme-app', 'helpdesk.html');
  const home = homeWith({
    [md]: { ago: MINUTE, text: '---\ntitle: Helpdesk profile\n---\n# Ignored\n' },
    [html]: { ago: 9 * MINUTE, text: '<title>Page title</title>' },
    [join('reports', 'plans', 'old.md')]: { ago: 5 * MINUTE },
    [join('reports', 'plans', 'guide.md')]: { ago: 6 * MINUTE, text: '## Only a section\n' },
    [join('reports', 'plans', 'guide.html')]: { ago: 6 * MINUTE, text: '<title>The guide</title>' }
  });
  const found = readRecentFiles(home, NOW);
  expect(
    found.map(({ path, title }) => ({ path, title })),
    'a note with no title of its own takes the page’s'
  ).toEqual([
    { path: html, title: 'Helpdesk profile' },
    { path: join('reports', 'plans', 'old.md'), title: 'old' },
    { path: join('reports', 'plans', 'guide.html'), title: 'The guide' }
  ]);
});

test('titles come from frontmatter, then the first heading, then a page’s title, then the file name', () => {
  const home = homeWith({
    'a.md': { ago: 0 },
    'USER.md': { ago: MINUTE, text: '# About Ada\n\nText.' },
    'roadmap.html': { ago: 2 * MINUTE, text: '<html><head><title> The plan </title></head></html>' },
    [join('projects', 'acme-app', 'brief.pdf')]: { ago: 3 * MINUTE }
  });
  expect(readRecentFiles(home, NOW).map((file) => file.title)).toEqual(['About Ada', 'The plan', 'brief.pdf']);
});

test('only the last 30 days count, and at most RECENT_LIMIT files', () => {
  const old = homeWith({ 'USER.md': { ago: 31 * DAY }, 'SOUL.md': { ago: 29 * DAY } });
  expect(readRecentFiles(old, NOW).map((file) => file.path)).toEqual(['SOUL.md']);
  const many = homeWith(
    Object.fromEntries(
      Array.from({ length: RECENT_LIMIT + 5 }, (_unused, index) => [
        join('reports', 'plans', `plan-${String(index).padStart(2, '0')}.md`),
        { ago: index * MINUTE }
      ])
    )
  );
  const found = readRecentFiles(many, NOW);
  expect(found).toHaveLength(RECENT_LIMIT);
  expect(found[0]?.path).toBe(join('reports', 'plans', 'plan-00.md'));
  expect(found.every(({ date, time }) => /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time))).toBe(true);
});

test('a missing home reads as nothing changed', () => {
  expect(readRecentFiles(layout(join(tmpdir(), 'no-such-home-for-recent')), NOW)).toEqual([]);
});

test('each file carries its kind and project from where it sits', () => {
  const home = homeWith({
    [join('projects', 'acme-app', 'tasks', 'ac-101.md')]: { ago: 0 },
    [join('projects', 'acme-app', 'roadmap.html')]: { ago: MINUTE },
    [join('projects', 'acme-app', 'pricing.html')]: { ago: 2 * MINUTE },
    [join('projects', 'acme-app', 'README.md')]: { ago: 3 * MINUTE },
    [join('reports', 'plans', 'spec.md')]: { ago: 4 * MINUTE },
    [join('knowledge', 'concepts', 'idea.md')]: { ago: 5 * MINUTE },
    [join('knowledge', 'memory', 'index.md')]: { ago: 6 * MINUTE },
    [join('extensions', 'skills', 'briefing.md')]: { ago: 7 * MINUTE },
    'roadmap.html': { ago: 8 * MINUTE },
    'SOUL.md': { ago: 9 * MINUTE }
  });
  expect(readRecentFiles(home, NOW).map(({ kind, project }) => `${kind}:${project}`)).toEqual([
    'task:acme-app',
    'roadmap:acme-app',
    'page:acme-app',
    'doc:acme-app',
    'plans:',
    'knowledge:',
    'memory:',
    'extension:',
    'roadmap:',
    'identity:'
  ]);
});

test('projects, reports and knowledge kept outside the home are found where they live, and open from the home', () => {
  const home = tempDir();
  const elsewhere = tempDir();
  writeFiles(home, { 'USER.md': { ago: 3 * MINUTE }, [join('projects', 'acme-app', 'README.md')]: { ago: 0 } });
  writeFiles(elsewhere, {
    [join('work', 'acme-app', 'tasks', 'ac-101.md')]: { ago: MINUTE },
    [join('notes', 'user', 'profile.md')]: { ago: 2 * MINUTE },
    [join('out', 'plans', 'spec.md')]: { ago: 4 * MINUTE }
  });
  const found = readRecentFiles(
    { home, projects: join(elsewhere, 'work'), reports: join(elsewhere, 'out'), knowledge: join(elsewhere, 'notes') },
    NOW
  );
  expect(found.map(({ path, kind }) => [join(home, path), kind])).toEqual([
    [join(elsewhere, 'work', 'acme-app', 'tasks', 'ac-101.md'), 'task'],
    [join(elsewhere, 'notes', 'user', 'profile.md'), 'knowledge'],
    [join(home, 'USER.md'), 'identity'],
    [join(elsewhere, 'out', 'plans', 'spec.md'), 'plans']
  ]);
});

test('the entry titles tasks and reports from the work model, and a report keeps its Reports kind', () => {
  const file = (title: string, kind: string, project: string, ...path: string[]) => ({
    path: join(...path),
    kind,
    project,
    date: '2026-11-09',
    time: '09:00',
    title
  });
  const { recent } = homeEntry(NOVA_HOME, NOVA, {
    recent: [
      file('ac-101', 'task', 'acme-app', 'projects', 'acme-app', 'tasks', 'ac-101.md'),
      file('morning', 'briefings', '', 'reports', 'briefings', '2026-11-09-0830-morning.md'),
      file('Acme roadmap', 'roadmap', 'acme-app', 'projects', 'acme-app', 'roadmap.html'),
      file('Profile', 'knowledge', '', 'knowledge', 'user', 'profile.md'),
      file('Memory', 'memory', '', 'knowledge', 'memory', 'index.md'),
      file('About Ada', 'identity', '', 'USER.md')
    ]
  });
  expect(recent?.map(({ title, kind, project }) => ({ title, kind, project }))).toEqual([
    { title: 'Ship the invoice export', kind: 'task', project: 'acme-app' },
    { title: 'Morning brief — Mon 9 Nov', kind: 'briefing', project: '' },
    { title: 'Acme roadmap', kind: 'roadmap', project: 'acme-app' },
    { title: 'Profile', kind: 'knowledge', project: '' },
    { title: 'Memory', kind: 'memory', project: '' },
    { title: 'About Ada', kind: 'identity', project: '' }
  ]);
  expect(recent?.[2]?.target).toEqual({
    kind: 'page',
    url: `file://${join(NOVA_HOME, 'projects', 'acme-app', 'roadmap.html')}`
  });
  expect(recent?.[0]?.target).toEqual({
    kind: 'file',
    path: join(NOVA_HOME, 'projects', 'acme-app', 'tasks', 'ac-101.md')
  });
});
