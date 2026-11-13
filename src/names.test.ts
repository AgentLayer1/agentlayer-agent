import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';

/** Folders that hold no shipped text: dependencies, history, and generated output. */
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'results', 'types']);
/** The one file that names the old plugin on purpose: the CHANGELOG points at its releases. */
const ALLOWED = new Set(['CHANGELOG.md', 'bun.lock']);
const TEXT = /\.(md|ts|tsx|json|yaml|yml|html|css|sh|toml|txt)$/;
const OLD_NAME = /kevin|🍌|minion/i;

const shippedFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : shippedFiles(path);
    }
    return entry.isFile() && TEXT.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

describe('the old name', () => {
  test('no shipped file names the plugin, persona or mascot this one replaced', () => {
    const offenders = shippedFiles(PLUGIN_SOURCE_ROOT)
      .filter((path) => !ALLOWED.has(relative(PLUGIN_SOURCE_ROOT, path)))
      .flatMap((path) =>
        readFileSync(path, 'utf-8')
          .split('\n')
          .flatMap((line, index) => (OLD_NAME.test(line) ? [`${relative(PLUGIN_SOURCE_ROOT, path)}:${index + 1}`] : []))
      );
    expect(offenders).toEqual([]);
  });
});
