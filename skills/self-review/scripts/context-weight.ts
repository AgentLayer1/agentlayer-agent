#!/usr/bin/env bun
/**
 * Bytes the agent home loads into every session, per host: Claude Code reads the bridge, what it
 * `@`-imports (recursively, prose only, never inside code), and the unscoped rule files; Codex
 * reads AGENTS.md natively and gets the identity stack from the SessionStart hook. An import that
 * does not resolve is listed and fails the run, so a partial total is never mistaken for a
 * baseline. `budget` is the ceiling each total is held to, and `growth` is each file's change since
 * the sizes the last sitting recorded. Read-only, except that `--record` saves today's sizes as
 * `weights` in the review watermark for the next sitting's `growth`.
 *
 * Usage: context-weight.ts [--home <dir>] [--record]   (--home: else the agent's home variable, else the cwd)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const homeFlag = args.indexOf('--home') === -1 ? undefined : args[args.indexOf('--home') + 1];
// The config module resolves the home from AGENT_HOME, so an explicit --home is exported before it loads.
if (homeFlag) process.env.AGENT_HOME = resolve(homeFlag);
const { CONTEXT, FOLDERS } = await import('../../../src/config');
const { agentHomePath, isAgentHome } = await import('../../../src/shared/env');
const { todayDate } = await import('../../../src/shared/date');
const { importedStack, injectedStack } = await import('../../../src/shared/weight');
const { isRecord } = await import('../../../src/shared/json-block');
const { writeJsonChecked } = await import('../../../src/shared/utils');

const home = agentHomePath();
if (!isAgentHome(home)) {
  console.error(`not an agent home: ${home}`);
  process.exit(2);
}

type Sizes = Record<string, number>;
interface Weights {
  date: string;
  claude: Sizes;
  codex: Sizes;
}

const claude = importedStack();
// The Codex hook skips a static file that is missing, so an absent one is reported, not an error.
const codex = injectedStack();

const sizes = (stack: typeof claude): Sizes =>
  Object.fromEntries(stack.files.map((file) => [relative(FOLDERS.HOME, file.path).split(sep).join('/'), file.bytes]));
const now: Weights = { date: todayDate(), claude: sizes(claude), codex: sizes(codex) };

const reviewPath = join(FOLDERS.DATA, 'review.json');
// Null when the watermark won't parse as an object: `--record` then leaves it for the operator.
const review = ((): Record<string, unknown> | null => {
  if (!existsSync(reviewPath)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(reviewPath, 'utf-8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
})();
const isSizes = (value: unknown): value is Sizes =>
  isRecord(value) && Object.values(value).every((bytes) => typeof bytes === 'number');
// A `weights` this script didn't write, or wrote in another shape, is no baseline.
const isWeights = (value: unknown): value is Weights =>
  isRecord(value) && typeof value.date === 'string' && isSizes(value.claude) && isSizes(value.codex);
const previous = isWeights(review?.weights) ? review.weights : null;

const change = (before: Sizes, after: Sizes) => {
  const files = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .map((file) => ({ file, bytes: (after[file] ?? 0) - (before[file] ?? 0) }))
    .filter(({ bytes }) => bytes !== 0)
    .toSorted((a, b) => b.bytes - a.bytes);
  return { total: files.reduce((sum, { bytes }) => sum + bytes, 0), files };
};
const growth = previous
  ? { since: previous.date, claude: change(previous.claude, now.claude), codex: change(previous.codex, now.codex) }
  : null;

process.stdout.write(
  `${JSON.stringify({ home: FOLDERS.HOME, budget: CONTEXT.ALWAYS_LOADED_BUDGET, claude, codex, growth }, null, 2)}\n`
);

if (args.includes('--record')) {
  if (review === null) {
    console.error(`not recorded: ${reviewPath} does not parse`);
    process.exit(1);
  }
  writeJsonChecked(reviewPath, { ...review, weights: now });
}
if (claude.unresolved.length > 0) process.exit(1);
