import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TEST_HOME_VAR } from '@/shared/naming';

const scratch = mkdtempSync(join(tmpdir(), 'env-preload-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const fixture = join(scratch, 'resolve.test.ts');
writeFileSync(
  fixture,
  [
    `import { test } from 'bun:test';`,
    `import { agentHomePath } from ${JSON.stringify(resolve(import.meta.dir, 'env.ts'))};`,
    `test('resolves', () => { agentHomePath(); });`
  ].join('\n')
);

// Run from outside the checkout, so bunfig.toml and its preload are never read. AGENT_HOME points at
// the scratch folder, so even a broken check can't reach a real home.
const runFixture = (marker: string) =>
  Bun.spawnSync(['bun', 'test', fixture], {
    cwd: scratch,
    env: { ...process.env, AGENT_HOME: scratch, [TEST_HOME_VAR]: marker },
    stderr: 'pipe',
    stdout: 'pipe'
  });

describe('a test run without the preload', () => {
  test('refuses to resolve a home', () => {
    const run = runFixture('');
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr.toString()).toContain("without the plugin's test preload");
  });

  test('resolves once the preload marker is set', () => {
    const run = runFixture(scratch);
    expect(run.stderr.toString()).toContain('1 pass');
    expect(run.exitCode).toBe(0);
  });
});
