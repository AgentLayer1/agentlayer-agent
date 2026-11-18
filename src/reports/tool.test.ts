import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '@/config';
import { readReports } from '@/reports/read';
import { writeReport } from '@/reports/reports';
import { z } from 'zod';
import { tools } from './tool';

const extra = tools.find((tool) => tool.name === 'report_write')?.inputSchema.extra;
const accepts = (value: unknown): boolean => extra !== undefined && z.safeParse(extra, value).success;

describe('report_write extra frontmatter', () => {
  test('accepts scalars and flat lists', () => {
    expect(accepts({ round: 1, kind: 'range', task: null, repos: ['acme', 'acme-web'] })).toBe(true);
  });

  test('rejects a key that would break the frontmatter line', () => {
    expect(accepts({ 'a: b': 1 })).toBe(false);
    expect(accepts({ 'two\nlines': 1 })).toBe(false);
    expect(accepts({ round_2: 1, 'related-ids': [] })).toBe(true);
  });

  test('rejects nested objects and lists of objects, which Obsidian shows as raw JSON', () => {
    expect(accepts({ repos: [{ name: 'acme', head: 'abc123' }] })).toBe(false);
    expect(accepts({ owner: { name: 'Ada' } })).toBe(false);
  });
});

describe('writeReport frontmatter', () => {
  test('quotes strings YAML would read back as numbers, booleans or null', async () => {
    const { path } = await writeReport({
      category: 'radar',
      slug: 'typed-strings',
      title: 'Typed strings',
      skill: 'attention',
      body: 'Body.',
      tags: ['acme', '745', 'true'],
      extra: { related_ids: ['abc123', '4096', 'null', ''], count: 3 },
    });
    const block = readFileSync(path, 'utf-8').split('---')[1] ?? '';
    expect(Bun.YAML.parse(block)).toMatchObject({
      tags: ['acme', '745', 'true'],
      related_ids: ['abc123', '4096', 'null', ''],
      count: 3,
    });
  });
});

describe('a report title or summary with a line break or brackets', () => {
  test('stays one frontmatter value and one index line', async () => {
    const title = 'Sweep [draft]\nsecond line';
    const { path } = await writeReport({ category: 'radar', slug: 'odd-title', title, skill: 'attention', body: 'Body.', summary: 'a\nb' });
    const block = readFileSync(path, 'utf-8').split('---')[1] ?? '';
    expect(Bun.YAML.parse(block)).toMatchObject({ title, summary: 'a\nb' });
    const line = readFileSync(join(FOLDERS.REPORTS, 'index.md'), 'utf-8').split('\n').find((entry) => entry.includes('odd-title'));
    expect(line).toContain('[Sweep \\[draft\\] second line](');
    const { collectStatus } = await import('@/status/collect');
    const titles = (await collectStatus()).reports.map((report) => report.title);
    expect(titles).toContain('Sweep [draft] second line');
  });
});

describe('report_write', () => {
  test('re-renders the derived views, so the dashboard shows the new report', async () => {
    const tasksMd = join(FOLDERS.PROJECTS, 'TASKS.md');
    mkdirSync(FOLDERS.PROJECTS, { recursive: true });
    rmSync(tasksMd, { force: true });
    await tools
      .find((tool) => tool.name === 'report_write')
      ?.handler({ category: 'radar', slug: 'checkpoints', title: 'Checkpoints', skill: 'attention', body: 'Two sessions.' });
    expect(existsSync(tasksMd)).toBe(true);
  });
});

describe("a home's own report categories", () => {
  const category = tools.find((tool) => tool.name === 'report_write')?.inputSchema.category;
  const acceptsCategory = (value: string): boolean => category !== undefined && z.safeParse(category, value).success;

  test('a kebab-case folder of its own is accepted, while captures and paths are refused', () => {
    expect(acceptsCategory('investigations')).toBe(true);
    expect(acceptsCategory('briefings')).toBe(true);
    expect(acceptsCategory('captures')).toBe(false);
    expect(acceptsCategory('../secrets')).toBe(false);
    expect(acceptsCategory('Health')).toBe(false);
  });

  test('a report written there, and one dropped there by hand, both reach the report list', async () => {
    const { path } = await writeReport({ category: 'investigations', slug: 'acme-payout', title: 'Acme payout', skill: 'investigate', body: 'Body.' });
    expect(path).toContain(join('reports', 'investigations'));
    const orphan = join(FOLDERS.REPORTS, 'audits', '2026-01-02-0304-grants.md');
    mkdirSync(join(FOLDERS.REPORTS, 'audits'), { recursive: true });
    writeFileSync(orphan, '# Grants audit\n');
    const shot = join(FOLDERS.REPORTS, 'captures', 'page.md');
    mkdirSync(join(FOLDERS.REPORTS, 'captures'), { recursive: true });
    writeFileSync(shot, '# Not a report\n');

    const titles = readReports().map((report) => report.title);
    expect(titles).toContain('Acme payout');
    expect(titles).toContain('Grants audit');
    expect(titles).not.toContain('Not a report');
    [path, orphan, shot].forEach((file) => rmSync(file, { force: true }));
  });
});

describe('an .html report', () => {
  test('is written as it is, with no frontmatter', async () => {
    const html = '<!doctype html><title>Health</title><p>ok</p>';
    const { path } = await writeReport({ category: 'reviews', slug: 'health', title: 'Health', skill: 'acme', body: html, ext: '.html' });
    expect(path.endsWith('.html')).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe(`${html}\n`);
    rmSync(path, { force: true });
  });
});
