import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inChunks, writeFileAtomic } from './utils';

describe('writeFileAtomic', () => {
  test("a rewrite keeps the file's permissions", () => {
    const file = join(mkdtempSync(join(tmpdir(), 'atomic-')), 'settings.local.json');
    writeFileSync(file, '{}');
    chmodSync(file, 0o600);
    writeFileAtomic(file, '{"env": {}}');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('inChunks', () => {
  test('keeps the order and never runs more than the chunk size at once', async () => {
    let running = 0;
    let peak = 0;
    const results = await inChunks([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await Bun.sleep(1);
      running -= 1;
      return item * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBe(3);
    expect(await inChunks([], 3, async (item: number) => item)).toEqual([]);
  });
});
