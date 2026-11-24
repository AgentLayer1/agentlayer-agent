import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { importedStack } from '@/shared/weight';

describe('importedStack', () => {
  test('an import naming a folder loads nothing and stops nothing', () => {
    const home = mkdtempSync(resolve(tmpdir(), 'weight-test-'));
    const priorHome = process.env.AGENT_HOME;
    process.env.AGENT_HOME = home;
    try {
      mkdirSync(resolve(home, '.claude'), { recursive: true });
      mkdirSync(resolve(home, 'knowledge'), { recursive: true });
      writeFileSync(resolve(home, '.claude', 'CLAUDE.md'), '@../knowledge\n@../AGENTS.md\n');
      writeFileSync(resolve(home, 'AGENTS.md'), 'x'.repeat(100));
      const stack = importedStack();
      expect(stack.files.map((file) => file.path).sort()).toEqual(
        [resolve(home, '.claude', 'CLAUDE.md'), resolve(home, 'AGENTS.md')].sort()
      );
      expect(stack.unresolved).toEqual([]);
    } finally {
      process.env.AGENT_HOME = priorHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
