#!/usr/bin/env bun
/**
 * Upgrade migration for v1.1.0: sections the templates dropped leave the home's copies too.
 *
 * The upgrade's merge keeps any `##` section a home has that the new template lacks, since it can't tell a
 * section the template removed from one the operator added. This release removed one from the manual
 * ("Engineering the Codebase", the plugin's own contributor rules) and moved two from the always-on Xcode rule
 * into the path-scoped one ("After an Xcode update", "Apple's skills"), where the merge adds them.
 *
 * Each is removed from the home only when its lines still match the template the home was built from, read
 * from the recorded base at `<HOME>/.state/template-base`, never by comparing with the new template. A section
 * the operator edited, or a home with no recorded base, is left as it is and reported, for the upgrade to ask.
 *
 * Run by the upgrade skill via `run_upgrade`. Idempotent.
 * Contract: prints a single-line JSON report as its LAST stdout line; exits non-zero on failure.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RUNTIME_DIR } from '../../../src/shared/naming';

const VERSION = '1.1.0';
const HOME = resolve(process.env.AGENT_HOME?.trim() || process.cwd());
const BASE = resolve(HOME, RUNTIME_DIR, 'template-base');

const MOVED =
  'The template moved this section to .claude/rules/xcode-project.md. Carry your changes there, then delete it here.';
interface Retired {
  file: string;
  template: string;
  heading: string;
  ask: string;
}

const RETIRED: readonly Retired[] = [
  {
    file: 'AGENTS.md',
    template: 'AGENTS.md',
    heading: '## Engineering the Codebase',
    ask: "The template dropped this section: it held the plugin's own contributor rules. Delete it unless you rely on it."
  },
  { file: '.claude/rules/xcode.md', template: 'rules/xcode.md', heading: '## After an Xcode update', ask: MOVED },
  { file: '.claude/rules/xcode.md', template: 'rules/xcode.md', heading: "## Apple's skills", ask: MOVED }
];

type Action = 'removed' | 'kept-edited' | 'kept-no-base' | 'not-present';

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

const wording = ({ section }: Split): string =>
  section
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join('\n');

const retire = ({ file, template, heading }: Retired): Action => {
  const homePath = resolve(HOME, file);
  if (!existsSync(homePath)) {
    return 'not-present';
  }
  const mine = splitAt(readFileSync(homePath, 'utf-8'), heading);
  if (!mine) {
    return 'not-present';
  }
  const basePath = resolve(BASE, template);
  const original = existsSync(basePath) ? splitAt(readFileSync(basePath, 'utf-8'), heading) : null;
  if (!original) {
    return 'kept-no-base';
  }
  if (wording(mine) !== wording(original)) {
    return 'kept-edited';
  }
  const before = mine.before.join('\n').trimEnd();
  const after = mine.after.join('\n').trim();
  writeFileSync(homePath, `${[before, after].filter(Boolean).join('\n\n')}\n`);
  return 'removed';
};

try {
  const sections = RETIRED.map((entry) => {
    const action = retire(entry);
    return {
      file: entry.file,
      heading: entry.heading,
      action,
      ...(action.startsWith('kept') ? { ask: entry.ask } : {})
    };
  });
  process.stdout.write(JSON.stringify({ ok: true, version: VERSION, home: HOME, sections }) + '\n');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
