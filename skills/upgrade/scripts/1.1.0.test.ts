import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '1.1.0.ts');

const SECTION = '## Engineering the Codebase\n\nWhen writing code in this project:\n\n- **Bun-first.** Use bun.\n';
const MANUAL = (section: string) =>
  `# Manual\n\n## Platform\n\nKeep the home safe.\n\n${section}\n## Where Your Code Lives\n\nYour codebase.\n`;
const RULE =
  "# Xcode\n\n## Ground rules\n\n- One build driver.\n\n## After an Xcode update\n\n- Bump the version file.\n\n## Apple's skills\n\n- Read them as files.\n";

const homes: string[] = [];
const makeHome = (files: Record<string, string>): string => {
  const home = mkdtempSync(join(tmpdir(), 'migrate-110-'));
  homes.push(home);
  Object.entries(files).forEach(([rel, content]) => {
    mkdirSync(dirname(join(home, rel)), { recursive: true });
    writeFileSync(join(home, rel), content);
  });
  return home;
};
const run = (home: string) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_'))) as Record<
    string,
    string
  >;
  const result = spawnSync('bun', [SCRIPT], { env: { ...env, AGENT_HOME: home }, encoding: 'utf-8' });
  const report = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as {
    sections?: { heading: string; action: string; ask?: string }[];
  };
  return {
    status: result.status,
    actions: Object.fromEntries((report.sections ?? []).map((entry) => [entry.heading, entry.action])),
    asks: Object.fromEntries((report.sections ?? []).map((entry) => [entry.heading, entry.ask ?? '']))
  };
};
const read = (home: string, rel: string): string => readFileSync(join(home, rel), 'utf-8');

afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));

describe('1.1.0 retired template sections', () => {
  test('a section still in the template wording is removed, its neighbours untouched, and a second run finds nothing', () => {
    const home = makeHome({
      'AGENTS.md': MANUAL(SECTION),
      '.state/template-base/AGENTS.md': MANUAL(SECTION),
      '.claude/rules/xcode.md': RULE,
      '.state/template-base/rules/xcode.md': RULE
    });
    expect(run(home)).toMatchObject({
      status: 0,
      actions: {
        '## Engineering the Codebase': 'removed',
        '## After an Xcode update': 'removed',
        "## Apple's skills": 'removed'
      }
    });
    expect(read(home, 'AGENTS.md')).toBe(MANUAL('').replace('\n\n\n', '\n\n'));
    expect(read(home, '.claude/rules/xcode.md')).toBe('# Xcode\n\n## Ground rules\n\n- One build driver.\n');
    expect(run(home).actions['## Engineering the Codebase']).toBe('not-present');
  });

  test('a section the operator edited is kept and reported', () => {
    const edited = SECTION.replace('Use bun.', 'Use bun, and pin its version.');
    const home = makeHome({ 'AGENTS.md': MANUAL(edited), '.state/template-base/AGENTS.md': MANUAL(SECTION) });
    expect(run(home).actions['## Engineering the Codebase']).toBe('kept-edited');
    expect(run(home).asks['## Engineering the Codebase']).toContain('Delete it unless you rely on it');
    expect(read(home, 'AGENTS.md')).toBe(MANUAL(edited));
  });

  test('a home with no recorded base is left alone: matching the new template would prove nothing', () => {
    const home = makeHome({ 'AGENTS.md': MANUAL(SECTION) });
    expect(run(home).actions['## Engineering the Codebase']).toBe('kept-no-base');
    expect(read(home, 'AGENTS.md')).toBe(MANUAL(SECTION));
  });

  test('a home without the Xcode pack has nothing to move', () => {
    const home = makeHome({ 'AGENTS.md': MANUAL(''), '.state/template-base/AGENTS.md': MANUAL(SECTION) });
    expect(run(home).actions).toEqual({
      '## Engineering the Codebase': 'not-present',
      '## After an Xcode update': 'not-present',
      "## Apple's skills": 'not-present'
    });
  });
});
