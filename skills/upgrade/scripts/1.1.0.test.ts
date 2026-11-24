import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '1.1.0.ts');

const SECTION = '## Engineering the Codebase\n\nWhen writing code in this project:\n\n- **Bun-first.** Use bun.\n';
const MANUAL = (section: string) =>
  `# Manual\n\n## Platform\n\nKeep the home safe.\n\n${section}\n## Where Your Code Lives\n\nYour codebase.\n`;
const SHIPPED_RULE =
  "# Xcode\n\n## Ground rules\n\n- One build driver.\n\n## After an Xcode update\n\n- Bump the version file.\n\n## Apple's skills\n\n- Read them as files.\n";
const SHIPPED_PROJECT = '---\npaths:\n  - "**/*.pbxproj"\n---\n\n# Xcode project files\n\n## project.pbxproj\n\n- Edit through the tools.\n';
const TEMPLATE = (name: string): string => readFileSync(resolve(import.meta.dir, '..', '..', '..', 'templates', 'rules', name), 'utf-8');
const XCODE = 'Xcode pack rules';
const shippedXcode = {
  '.claude/rules/xcode.md': SHIPPED_RULE,
  '.state/template-base/rules/xcode.md': SHIPPED_RULE,
  '.claude/rules/xcode-project.md': SHIPPED_PROJECT,
  '.state/template-base/rules/xcode-project.md': SHIPPED_PROJECT
};

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
    const home = makeHome({ 'AGENTS.md': MANUAL(SECTION), '.state/template-base/AGENTS.md': MANUAL(SECTION) });
    expect(run(home)).toMatchObject({ status: 0, actions: { '## Engineering the Codebase': 'removed' } });
    expect(read(home, 'AGENTS.md')).toBe(MANUAL('').replace('\n\n\n', '\n\n'));
    expect(run(home).actions['## Engineering the Codebase']).toBe('not-present');
  });

  test("the operator's own spacing elsewhere in the file is left as it is", () => {
    const spaced = `# Manual\n\n\n\n## Platform\n\nKeep the home safe.\n\n${SECTION}\n## Where Your Code Lives\n\n\n\nYour codebase.\n`;
    const home = makeHome({ 'AGENTS.md': spaced, '.state/template-base/AGENTS.md': MANUAL(SECTION) });
    expect(run(home).actions['## Engineering the Codebase']).toBe('removed');
    expect(read(home, 'AGENTS.md')).toBe(
      '# Manual\n\n\n\n## Platform\n\nKeep the home safe.\n\n## Where Your Code Lives\n\n\n\nYour codebase.\n'
    );
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
    expect(run(home).actions).toEqual({ '## Engineering the Codebase': 'not-present', [XCODE]: 'not-present' });
  });
});

describe('1.1.0 Xcode pack rules', () => {
  test('shipped copies of both files become the new templates together, and a second run finds them current', () => {
    const home = makeHome(shippedXcode);
    expect(run(home).actions[XCODE]).toBe('replaced');
    expect(read(home, '.claude/rules/xcode.md')).toBe(TEMPLATE('xcode.md'));
    expect(read(home, '.claude/rules/xcode-project.md')).toBe(TEMPLATE('xcode-project.md'));
    expect(read(home, '.claude/rules/xcode-project.md'), 'the moved reference arrives').toContain("## Apple's skills");
    expect(run(home).actions[XCODE]).toBe('current');
  });

  test('an edit to either file keeps both as they are, so nothing leaves the always-on rule unmoved', () => {
    const edited = `${SHIPPED_PROJECT}\n- My own pbxproj note.\n`;
    const home = makeHome({ ...shippedXcode, '.claude/rules/xcode-project.md': edited });
    const { actions, asks } = run(home);
    expect(actions[XCODE]).toBe('kept-edited');
    expect(asks[XCODE]).toContain('merge them');
    expect(read(home, '.claude/rules/xcode.md')).toBe(SHIPPED_RULE);
    expect(read(home, '.claude/rules/xcode-project.md')).toBe(edited);
  });

  test('a shipped always-on rule with its scoped file missing gets both', () => {
    const home = makeHome({ '.claude/rules/xcode.md': SHIPPED_RULE, '.state/template-base/rules/xcode.md': SHIPPED_RULE });
    expect(run(home).actions[XCODE]).toBe('replaced');
    expect(read(home, '.claude/rules/xcode-project.md')).toBe(TEMPLATE('xcode-project.md'));
  });

  test('without a recorded base nothing is replaced', () => {
    const home = makeHome({ '.claude/rules/xcode.md': SHIPPED_RULE, '.claude/rules/xcode-project.md': SHIPPED_PROJECT });
    expect(run(home).actions[XCODE]).toBe('kept-no-base');
    expect(read(home, '.claude/rules/xcode.md')).toBe(SHIPPED_RULE);
  });
});

describe('1.1.0 daily memory', () => {
  const DAY = [
    '# 2026-11-22',
    '',
    '## Heartbeat',
    '',
    '- 09:43 brain refresh: compiled 5, lint fixed 1, nothing stalled.',
    '- 09:43 and 10:38 proposal looks: nothing new worth proposing.',
    '',
    '## Work',
    '',
    '- Fixed the banner; the look found nothing new.',
    '- **Band fix `3f6b7ab`**: a look ending "Nothing new worth proposing." drew a green tick.',
    '- Proposal looks were reworked:',
    '  1. one swap per look',
    ''
  ].join('\n');

  test("bullets that only report a heartbeat look or refresh go, with a section they leave empty; the rest stays", () => {
    const home = makeHome({ 'knowledge/memory/2026-11-22.md': DAY, 'knowledge/memory/index.md': '- 09:43 proposal looks: nothing new worth proposing.\n' });
    const result = spawnSync('bun', [SCRIPT], { env: { ...process.env, AGENT_HOME: home }, encoding: 'utf-8' });
    const report = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}');
    expect(report.dailyMemory).toEqual([
      {
        file: 'knowledge/memory/2026-11-22.md',
        removed: [
          '- 09:43 brain refresh: compiled 5, lint fixed 1, nothing stalled.',
          '- 09:43 and 10:38 proposal looks: nothing new worth proposing.'
        ]
      }
    ]);
    const after = read(home, 'knowledge/memory/2026-11-22.md');
    expect(after).not.toContain('## Heartbeat');
    expect(after).toContain('## Work');
    expect(after).toContain('Band fix');
    expect(after, 'a bullet with its own sub-items stays').toContain('- Proposal looks were reworked:\n  1. one swap per look');
    expect(read(home, 'knowledge/memory/index.md'), 'the memory index is the self-review\'s').toContain('proposal looks');
  });
});
