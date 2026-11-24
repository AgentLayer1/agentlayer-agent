#!/usr/bin/env bun
/**
 * Upgrade migration for v1.1.0: sections the templates dropped leave the home's copies too.
 *
 * The upgrade's merge keeps any `##` section a home has that the new template lacks, since it can't tell a
 * section the template removed from one the operator added. This release removed one from the manual
 * ("Engineering the Codebase", the plugin's own contributor rules), which is removed from the home only when its
 * lines still match the template the home was built from.
 *
 * It also trimmed the always-on Xcode rule and moved its reference material into the path-scoped one. The upgrade
 * never merges those two pack files, so they move together here: both are replaced by the new templates when each
 * is the shipped copy or already the new one, and both are kept when either was edited, so nothing leaves the
 * first before it reaches the second.
 *
 * "Shipped" means the recorded base at `<HOME>/.state/template-base`, never a comparison with the new template.
 * Anything edited, or a home with no recorded base, is left as it is and reported, for the upgrade to ask.
 *
 * The heartbeat's looks and brain refreshes were captured and compiled into the daily memory files until this
 * release. Each daily file loses the bullets that only report one ("09:43 and 10:38 proposal looks: nothing new
 * worth proposing"), and a section left empty goes with them. A bullet that carries code or a commit in backticks is
 * a note about the heartbeat's own development and stays; the memory index's lines are the self-review's, on a yes.
 * Every removed line is in the report.
 *
 * Run by the upgrade skill via `run_upgrade`. Idempotent.
 * Contract: prints a single-line JSON report as its LAST stdout line; exits non-zero on failure.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isBackgroundReport } from '../../../src/knowledge/background-noise';
import { RUNTIME_DIR } from '../../../src/shared/naming';

const VERSION = '1.1.0';
const HOME = resolve(process.env.AGENT_HOME?.trim() || process.cwd());
const BASE = resolve(HOME, RUNTIME_DIR, 'template-base');
const TEMPLATES = resolve(import.meta.dir, '..', '..', '..', 'templates');

const RETIRED = {
  file: 'AGENTS.md',
  heading: '## Engineering the Codebase',
  ask: "The template dropped this section: it held the plugin's own contributor rules. Delete it unless you rely on it."
} as const;

const XCODE_RULES = ['xcode.md', 'xcode-project.md'] as const;
const XCODE_ASK =
  "The template trimmed the always-on Xcode rule and moved its reference sections (after an Xcode update, Apple's skills, previews) into xcode-project.md. Your copies differ from the shipped ones, so they were left as they are: merge them with the plugin's templates/rules/xcode.md and xcode-project.md by hand.";

type Action = 'removed' | 'replaced' | 'current' | 'kept-edited' | 'kept-no-base' | 'not-present';

interface Split {
  before: string[];
  section: string[];
  after: string[];
}

const splitAt = (text: string, heading: string): Split | null => {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === heading);
  if (start === -1) {
    return null;
  }
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  const end = next === -1 ? lines.length : next;
  return { before: lines.slice(0, start), section: lines.slice(start, end), after: lines.slice(end) };
};

const wording = (lines: readonly string[]): string =>
  lines
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join('\n');

const readIfThere = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf-8') : null);

const retire = ({ file, heading }: typeof RETIRED): Action => {
  const homePath = resolve(HOME, file);
  const text = readIfThere(homePath);
  const mine = text === null ? null : splitAt(text, heading);
  if (!mine) {
    return 'not-present';
  }
  const base = readIfThere(resolve(BASE, file));
  const original = base === null ? null : splitAt(base, heading);
  if (!original) {
    return 'kept-no-base';
  }
  if (wording(mine.section) !== wording(original.section)) {
    return 'kept-edited';
  }
  const before = mine.before.join('\n').trimEnd();
  const after = mine.after.join('\n').trim();
  writeFileSync(homePath, `${[before, after].filter(Boolean).join('\n\n')}\n`);
  return 'removed';
};

const sameWording = (a: string, b: string): boolean => wording(a.split('\n')) === wording(b.split('\n'));

const updateXcodeRules = (): Action => {
  const rules = XCODE_RULES.map((name) => {
    const home = resolve(HOME, '.claude', 'rules', name);
    return {
      home,
      mine: readIfThere(home),
      base: readIfThere(resolve(BASE, 'rules', name)),
      next: readFileSync(resolve(TEMPLATES, 'rules', name), 'utf-8')
    };
  });
  if (rules.every(({ mine }) => mine === null)) {
    return 'not-present';
  }
  const pending = rules.filter(({ mine, next }) => mine === null || !sameWording(mine, next));
  if (pending.length === 0) {
    return 'current';
  }
  const present = pending.flatMap(({ mine, base }) => (mine === null ? [] : [{ mine, base }]));
  if (present.some(({ base }) => base === null)) {
    return 'kept-no-base';
  }
  if (present.some(({ mine, base }) => base !== null && !sameWording(mine, base))) {
    return 'kept-edited';
  }
  pending.forEach(({ home, next }) => writeFileSync(home, next));
  return 'replaced';
};

const MEMORY = resolve(HOME, 'knowledge', 'memory');

// Without its background reports, and without a section they leave empty.
const withoutReports = (text: string): { kept: string; removed: string[] } => {
  const lines = text.split('\n');
  const removable = (line: string, index: number): boolean =>
    line.startsWith('- ') && !line.includes('`') && isBackgroundReport(line) && !/^\s+\S/.test(lines[index + 1] ?? '');
  const removed = lines.filter(removable);
  const sections = lines
    .filter((line, index) => !removable(line, index))
    .join('\n')
    .split(/^(?=## )/m)
    .filter((section) => !section.startsWith('## ') || section.split('\n').slice(1).some((line) => line.trim() !== ''));
  return { kept: sections.join('').replace(/\n{3,}/g, '\n\n'), removed };
};

const cleanDailyMemory = (): { file: string; removed: string[] }[] =>
  (existsSync(MEMORY) ? readdirSync(MEMORY) : [])
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .toSorted()
    .flatMap((name) => {
      const path = join(MEMORY, name);
      const { kept, removed } = withoutReports(readFileSync(path, 'utf-8'));
      if (removed.length === 0) {
        return [];
      }
      writeFileSync(path, kept);
      return [{ file: join('knowledge', 'memory', name), removed }];
    });

try {
  const manual = retire(RETIRED);
  const xcode = updateXcodeRules();
  const sections = [
    {
      file: RETIRED.file,
      heading: RETIRED.heading,
      action: manual,
      ...(manual.startsWith('kept') ? { ask: RETIRED.ask } : {})
    },
    {
      file: XCODE_RULES.map((name) => join('.claude', 'rules', name)).join(', '),
      heading: 'Xcode pack rules',
      action: xcode,
      ...(xcode.startsWith('kept') ? { ask: XCODE_ASK } : {})
    }
  ];
  const dailyMemory = cleanDailyMemory();
  process.stdout.write(JSON.stringify({ ok: true, version: VERSION, home: HOME, sections, dailyMemory }) + '\n');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
