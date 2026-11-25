import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '1.2.0.ts');

const task = (id: string, project: string, extra = ''): string =>
  `---\nschema: 1\nid: ${id}\ntitle: ${id}\ntype: task\nstatus: open\npriority: P1\nproject: ${project}\nassignee: [agent]\nlabels: [tax]\ncreated: 2026-01-01\nupdated: 2026-01-01\ndue:\n${extra}depends_on: []\nblocked_by:\nparent:\nclosed:\n---\n\n## Description\n\nx\n`;

const TAX_HOME = {
  'projects/tax/README.md':
    '---\naudience: [ada]\n---\n\n# Tax & Books\n\n## Entities\n\n| Entity | Profile |\n|---|---|\n| Acme | [entities/acme.md](entities/acme.md) |\n',
  'projects/tax/entities/acme.md': '---\nname: Acme Sdn. Bhd.\n---\n',
  'projects/tax/closes/acme/2026-09.md': '---\nmonth: "2026-09"\n---\n',
  'projects/tax/ledger/acme/2026.csv':
    'date,type,counterparty,country,currency,amount,amount_myr,tax,reference,category,file,flags,notes\n2026-09-28,receipt,Shop,MY,MYR,10,,0,,,receipts/acme/2026-09/2026-09-28 Shop 10 MYR.pdf,,\n2026-09-29,receipt,Other,MY,MYR,5,,0,,,"receipts/acme/2026-09/a, b.pdf",,\n',
  'projects/tax/receipts/acme/2026-09/2026-09-28 Shop 10 MYR.pdf': '%PDF-1.4 receipt',
  'projects/tax/inbox/new.pdf': '%PDF-1.4 inbox',
  'projects/tax/dashboard.html': '<html>generated</html>',
  'projects/tax/tasks/ta-001-file-it.md': task('ta-001', 'tax', '').replace('depends_on: []', 'depends_on: [ta-002]'),
  'projects/tax/tasks/archive/ta-002-older.md': task('ta-002', 'tax'),
  'projects/finances/README.md': '# Finances\n\nMoney in one place.\n',
  'projects/finances/dashboard.html': '<html>mockup</html>',
  'projects/finances/tasks/fp-001-model.md': task('fp-001', 'finances'),
  'projects/finances/tasks/fp-002-store.md': task('fp-002', 'finances'),
  'projects/finances/tasks/archive/fp-003-old.md': task('fp-003', 'finances'),
  'projects/other/tasks/ot-001-x.md': task('ot-001', 'other').replace(
    '\nx\n',
    '\nSee [[ta-001-file-it|ta-001]] and ta-0010.\n'
  )
};

const homes: string[] = [];
const makeHome = (files: Record<string, string>): string => {
  const home = mkdtempSync(join(tmpdir(), 'migrate-120-'));
  homes.push(home);
  Object.entries(files).forEach(([rel, content]) => {
    mkdirSync(dirname(join(home, rel)), { recursive: true });
    writeFileSync(join(home, rel), content);
  });
  return home;
};

interface Report {
  ok: boolean;
  moved: string[];
  conflicts: string[];
  renumbered: Record<string, string>;
  dropped: string[];
}

const run = (home: string): Report => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_'))) as Record<
    string,
    string
  >;
  const result = spawnSync('bun', [SCRIPT], { env: { ...env, AGENT_HOME: home }, encoding: 'utf-8' });
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as Report;
};

const read = (home: string, rel: string): string => readFileSync(join(home, rel), 'utf-8');

afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));

describe('1.2.0 migration', () => {
  test('a home without a tax project is left as it is', () => {
    const home = makeHome({ 'projects/finances/README.md': '# Finances\n' });
    const report = run(home);
    expect(report.ok).toBe(true);
    expect(report.moved).toEqual([]);
    expect(existsSync(join(home, '.gitignore'))).toBe(false);
  });

  test('moves the books under finances, the private files under data/, and ignores data/ first', () => {
    const home = makeHome(TAX_HOME);
    const report = run(home);
    expect(report.ok).toBe(true);
    expect(report.conflicts).toEqual([]);
    expect(read(home, '.gitignore')).toContain('projects/finances/data/');
    expect(read(home, '.gitignore')).toContain('projects/finances/dashboard.html');
    expect(read(home, 'projects/finances/entities/acme.md')).toContain('Acme');
    expect(existsSync(join(home, 'projects/finances/closes/acme/2026-09.md'))).toBe(true);
    expect(read(home, 'projects/finances/data/originals/acme/2026-09/2026-09-28 Shop 10 MYR.pdf')).toBe(
      '%PDF-1.4 receipt'
    );
    expect(read(home, 'projects/finances/data/inbox/new.pdf')).toBe('%PDF-1.4 inbox');
    expect(existsSync(join(home, 'projects/tax'))).toBe(false);
  });

  test("points each ledger row's file at its receipt's new place, quoted or not", () => {
    const home = makeHome(TAX_HOME);
    run(home);
    const ledger = read(home, 'projects/finances/data/ledger/acme/2026.csv');
    expect(ledger).toContain(',data/originals/acme/2026-09/2026-09-28 Shop 10 MYR.pdf,');
    expect(ledger).toContain(',"data/originals/acme/2026-09/a, b.pdf",');
    expect(ledger).not.toContain(',receipts/');
  });

  test('renumbers tax tasks after the highest finances id, archive included, and rewrites every reference', () => {
    const home = makeHome(TAX_HOME);
    const report = run(home);
    expect(report.renumbered).toEqual({ 'ta-001': 'fp-004', 'ta-002': 'fp-005' });
    const moved = read(home, 'projects/finances/tasks/fp-004-file-it.md');
    expect(moved).toContain('id: fp-004');
    expect(moved).toContain('project: finances');
    expect(moved).toContain('depends_on: [fp-005]');
    expect(read(home, 'projects/finances/tasks/archive/fp-005-older.md')).toContain('id: fp-005');
    expect(read(home, 'projects/other/tasks/ot-001-x.md')).toContain('[[fp-004-file-it|fp-004]] and ta-0010.');
  });

  test("folds the tax README into the finances one with the id map, and keeps the hand-built mockup out of the engine's way", () => {
    const home = makeHome(TAX_HOME);
    const report = run(home);
    const readme = read(home, 'projects/finances/README.md');
    expect(readme.startsWith('# Finances\n\nMoney in one place.\n\n## Tax\n\n### Entities')).toBe(true);
    expect(readme).toContain('| ta-001 | fp-004 |');
    expect(readme).not.toContain('audience');
    expect(read(home, 'projects/finances/data/design/dashboard.html')).toBe('<html>mockup</html>');
    expect(existsSync(join(home, 'projects/finances/dashboard.html'))).toBe(false);
    expect(report.dropped).toEqual(['projects/tax/dashboard.html']);
  });

  test('keeps the tax task ids when finances has no tasks of its own', () => {
    const home = makeHome({
      'projects/tax/tasks/ta-001-file-it.md': task('ta-001', 'tax')
    });
    const report = run(home);
    expect(report.renumbered).toEqual({});
    expect(read(home, 'projects/finances/tasks/ta-001-file-it.md')).toContain('project: finances');
  });

  test('a second run changes nothing', () => {
    const home = makeHome(TAX_HOME);
    run(home);
    const readme = read(home, 'projects/finances/README.md');
    const report = run(home);
    expect(report.moved).toEqual([]);
    expect(read(home, 'projects/finances/README.md')).toBe(readme);
  });

  test('a file whose destination differs stays in the tax project and is reported', () => {
    const home = makeHome({ ...TAX_HOME, 'projects/finances/entities/acme.md': '---\nname: Something else\n---\n' });
    const report = run(home);
    expect(report.conflicts).toEqual(['projects/tax/entities/acme.md']);
    expect(read(home, 'projects/tax/entities/acme.md')).toContain('Acme');
    expect(read(home, 'projects/finances/entities/acme.md')).toContain('Something else');
  });
});
