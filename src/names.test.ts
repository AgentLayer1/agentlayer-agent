import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';

/** The files that name the old plugin on purpose: the CHANGELOG points at its releases, the lockfile at its package. */
const ALLOWED = new Set(['CHANGELOG.md', 'bun.lock']);
const TEXT = /\.(md|ts|tsx|json|yaml|yml|html|css|sh|toml|txt)$/;
const OLD_NAME = /kevin|🍌|\bminions?\b/i;

/** Every text file git tracks or would add, tests aside. */
const shippedFiles = (): string[] =>
  execFileSync('git', ['-C', PLUGIN_SOURCE_ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\0')
    .filter((path) => TEXT.test(path) && !/\.test\.tsx?$/.test(path) && !ALLOWED.has(path));

describe('the old name', () => {
  test('no shipped file names the plugin, persona or mascot this one replaced', () => {
    const files = shippedFiles();
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((path) =>
      readFileSync(join(PLUGIN_SOURCE_ROOT, path), 'utf-8')
        .split('\n')
        .flatMap((line, index) => (OLD_NAME.test(line) ? [`${path}:${index + 1}`] : []))
    );
    expect(offenders).toEqual([]);
  });
});
