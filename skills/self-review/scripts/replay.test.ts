import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'replay.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("builds a home per ref from that ref's templates, and a run script whose answer names hide the ref", () => {
  const work = mkdtempSync(join(tmpdir(), 'replay-test-'));
  dirs.push(work);
  writeFileSync(join(work, 'prompt.txt'), 'What should I check next?\n');
  const proc = spawnSync(process.execPath, [
    SCRIPT,
    '--prompt',
    join(work, 'prompt.txt'),
    '--refs',
    'HEAD,HEAD',
    '--runs',
    '2'
  ]);
  expect(proc.status).toBe(0);
  const { root, answers } = JSON.parse(proc.stdout.toString()) as { root: string; answers: number };
  dirs.push(root);

  expect(answers).toBe(4);
  const manual = readFileSync(join(root, 'home-1', 'AGENTS.md'), 'utf-8');
  expect(manual).toContain('## Memory Routing');
  expect(manual).not.toContain('{{');
  expect(readdirSync(join(root, 'home-2'))).toContain('SOUL.md');

  const key = JSON.parse(readFileSync(join(root, 'key.json'), 'utf-8')) as Record<string, string>;
  expect(Object.keys(key).toSorted()).toEqual(['answer-01.txt', 'answer-02.txt', 'answer-03.txt', 'answer-04.txt']);
  const script = readFileSync(join(root, 'run.sh'), 'utf-8');
  expect(script.match(/claude -p/g)).toHaveLength(4);
});

test('refuses a missing prompt, and a single ref, which leaves nothing to compare', () => {
  const work = mkdtempSync(join(tmpdir(), 'replay-test-'));
  dirs.push(work);
  writeFileSync(join(work, 'prompt.txt'), 'What next?\n');
  expect(spawnSync(process.execPath, [SCRIPT, '--prompt', '/nonexistent', '--refs', 'HEAD,HEAD']).status).toBe(2);
  expect(spawnSync(process.execPath, [SCRIPT, '--prompt', join(work, 'prompt.txt'), '--refs', 'HEAD']).status).toBe(2);
});
