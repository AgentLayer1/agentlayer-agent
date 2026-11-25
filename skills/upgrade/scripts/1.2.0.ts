#!/usr/bin/env bun
/**
 * Upgrade migration for v1.2.0: the tax skill folded into the finances skill, so `projects/tax/` merges into
 * `projects/finances/`.
 *
 * Profiles, closes, estimates and reviews move to the same place under `projects/finances/`. The ledger, the filed
 * receipts and the inbox move under `projects/finances/data/`, which the home's `.gitignore` keeps out of history
 * (it is reconciled with the template first, so nothing moved there is ever staged), and each ledger row's `file`
 * path follows its receipt. The generated tax dashboard is dropped; a `projects/finances/dashboard.html` already
 * there was written by hand, so it moves to `data/design/` rather than being overwritten by the engine.
 *
 * A project's tasks share one id prefix, so tax tasks moving into a finances folder that already has its own are
 * renumbered from the task system's next id there, and every task file under `projects/` that names an old id is
 * rewritten. Each moved task gains the `tax` label the tax engine now reads them by. The map from old to new ids is appended to the finances README with the tax README's body. A file
 * whose destination already holds something different stays where it is and is reported.
 *
 * Run by the upgrade skill via `run_upgrade`. Idempotent: a home without `projects/tax/` is left as it is.
 * Contract: prints a single-line JSON report as its LAST stdout line; exits non-zero on failure.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { reconcileHomeGitignore } from '../../../src/home/gitignore';
import { stripFrontmatter } from '../../../src/knowledge/utils';
import { getNextId, getProjectPrefix } from '../../../src/tasks/scan';

const VERSION = '1.2.0';
const HOME = resolve(process.env.AGENT_HOME?.trim() || process.cwd());
const PROJECTS = resolve(process.env.AGENT_PROJECTS?.trim() || join(HOME, 'projects'));
const TAX = join(PROJECTS, 'tax');
const FIN = join(PROJECTS, 'finances');
const TEMPLATE_GITIGNORE = resolve(import.meta.dir, '..', '..', '..', 'templates', '.gitignore');

const MOVES: readonly (readonly [string, string])[] = [
  ['entities', 'entities'],
  ['closes', 'closes'],
  ['estimates', 'estimates'],
  ['reviews', 'reviews'],
  ['ledger', join('data', 'ledger')],
  ['receipts', join('data', 'originals')],
  ['inbox', join('data', 'inbox')]
];
const TASK_NAME = /^([a-z]{2,})-(\d+)(.*)\.md$/;

interface Report {
  moved: string[];
  conflicts: string[];
  renumbered: Record<string, string>;
  rewritten: string[];
  dropped: string[];
}

const filesUnder = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: 'utf-8' })
        .map((rel) => join(dir, rel))
        .filter((path) => statSync(path).isFile())
    : [];

const sameContent = (a: string, b: string): boolean => readFileSync(a).equals(readFileSync(b));

/** Moves one file; an identical copy already at the target just drops the source, a different one is a conflict. */
const moveFile = (source: string, target: string, report: Report): void => {
  if (existsSync(target)) {
    if (sameContent(source, target)) {
      rmSync(source);
    } else {
      report.conflicts.push(relative(HOME, source));
    }
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  renameSync(source, target);
  report.moved.push(`${relative(HOME, source)} → ${relative(HOME, target)}`);
};

const moveTree = (from: string, to: string, report: Report): void =>
  filesUnder(from).forEach((source) => moveFile(source, join(to, relative(from, source)), report));

const removeEmptyDirs = (dir: string): void => {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return;
  }
  readdirSync(dir).forEach((name) => removeEmptyDirs(join(dir, name)));
  if (readdirSync(dir).length === 0) {
    rmSync(dir, { recursive: true });
  }
};

/** Rewrites a file through `change`, recording it only when something changed. */
const rewrite = (path: string, change: (text: string) => string, report: Report): void => {
  const before = readFileSync(path, 'utf-8');
  const after = change(before);
  if (after !== before) {
    writeFileSync(path, after);
    report.rewritten.push(relative(HOME, path));
  }
};

const rewriteLedgerPaths = (report: Report): void =>
  filesUnder(join(FIN, 'data', 'ledger'))
    .filter((path) => path.endsWith('.csv'))
    .forEach((path) => rewrite(path, (text) => text.replace(/(^|,)("?)receipts\//gm, '$1$2data/originals/'), report));

/** A moved task's frontmatter: the finances project, and the `tax` label added to its flow-style list. */
const asFinancesTask = (text: string): string =>
  text.replace(/^project: tax$/m, 'project: finances').replace(/^labels: \[(.*)\]$/m, (line, items: string) => {
    const labels = items
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    return labels.some((label) => label.replace(/^["']|["']$/g, '') === 'tax')
      ? line
      : `labels: [${['tax', ...labels].join(', ')}]`;
  });

const taskFiles = (projectDir: string): string[] =>
  [join(projectDir, 'tasks'), join(projectDir, 'tasks', 'archive')]
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => TASK_NAME.test(name))
        .map((name) => join(dir, name))
    );

const taskName = (path: string): RegExpExecArray | null => TASK_NAME.exec(basename(path));
const prefixOf = (path: string): string => taskName(path)?.[1] ?? '';
const idOf = (path: string): string => `${prefixOf(path)}-${taskName(path)?.[2] ?? ''}`;

const idPattern = (id: string): RegExp => new RegExp(`\\b${id}(?!\\d)`, 'g');

const moveTasks = (report: Report): void => {
  const taxTasks = taskFiles(TAX).toSorted((a, b) => idOf(a).localeCompare(idOf(b)));
  const live = existsSync(join(FIN, 'tasks')) && readdirSync(join(FIN, 'tasks')).some((name) => TASK_NAME.test(name));
  const prefix = live ? getProjectPrefix('finances') : null;
  const next = prefix === null ? 0 : Number(getNextId('finances').slice(prefix.length + 1));
  const renames = new Map(
    taxTasks
      .filter((path) => prefix !== null && prefixOf(path) !== prefix)
      .map((path, i) => [idOf(path), `${prefix}-${String(next + i).padStart(3, '0')}`] as const)
  );
  taxTasks.forEach((source) => {
    const oldId = idOf(source);
    const target = join(
      FIN,
      relative(TAX, dirname(source)),
      basename(source).replace(oldId, renames.get(oldId) ?? oldId)
    );
    if (existsSync(target)) {
      report.conflicts.push(relative(HOME, source));
      return;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, asFinancesTask(readFileSync(source, 'utf-8')));
    rmSync(source);
    report.moved.push(`${relative(HOME, source)} → ${relative(HOME, target)}`);
  });
  Object.assign(report.renumbered, Object.fromEntries(renames));
  if (renames.size === 0) {
    return;
  }
  readdirSync(PROJECTS)
    .flatMap((project) => taskFiles(join(PROJECTS, project)))
    .forEach((path) =>
      rewrite(
        path,
        (text) => [...renames].reduce((acc, [oldId, newId]) => acc.replace(idPattern(oldId), newId), text),
        report
      )
    );
};

const body = (markdown: string): string =>
  stripFrontmatter(markdown)
    .replace(/^\s*# .*\n/, '')
    .trim();

const mergeReadme = (report: Report): void => {
  const taxReadme = join(TAX, 'README.md');
  if (!existsSync(taxReadme)) {
    return;
  }
  const finReadme = join(FIN, 'README.md');
  const idMap = Object.entries(report.renumbered);
  const mapBlock =
    idMap.length === 0
      ? ''
      : `\n\n### Renumbered tax tasks\n\nThe tax tasks moved here on the 1.2.0 upgrade under new ids; older notes use the old ones.\n\n| Old | New |\n|---|---|\n${idMap.map(([oldId, newId]) => `| ${oldId} | ${newId} |`).join('\n')}`;
  const section = `## Tax\n\n${body(readFileSync(taxReadme, 'utf-8')).replace(/^## /gm, '### ')}${mapBlock}\n`;
  const existing = existsSync(finReadme) ? readFileSync(finReadme, 'utf-8') : '# Finances\n';
  if (!existing.includes('\n## Tax\n')) {
    writeFileSync(finReadme, `${existing.trimEnd()}\n\n${section}`);
    report.rewritten.push(relative(HOME, finReadme));
  }
  rmSync(taxReadme);
};

const migrate = (): Report => {
  const report: Report = { moved: [], conflicts: [], renumbered: {}, rewritten: [], dropped: [] };
  if (!existsSync(TAX)) {
    return report;
  }
  reconcileHomeGitignore(HOME, TEMPLATE_GITIGNORE, true);
  const mockup = join(FIN, 'dashboard.html');
  if (existsSync(mockup)) {
    moveFile(mockup, join(FIN, 'data', 'design', 'dashboard.html'), report);
  }
  MOVES.forEach(([from, to]) => moveTree(join(TAX, from), join(FIN, to), report));
  rewriteLedgerPaths(report);
  moveTasks(report);
  mergeReadme(report);
  const generated = join(TAX, 'dashboard.html');
  if (existsSync(generated)) {
    rmSync(generated);
    report.dropped.push(relative(HOME, generated));
  }
  moveTree(TAX, FIN, report);
  removeEmptyDirs(TAX);
  return { ...report, conflicts: [...new Set(report.conflicts)] };
};

try {
  const report = migrate();
  process.stdout.write(JSON.stringify({ ok: true, version: VERSION, home: HOME, ...report }) + '\n');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
