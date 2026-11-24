import { describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';

// Every home loads the manual into every session, and Codex reads only its first 32,768 bytes unless a home raises
// the limit. This is its size today, and it only comes down.
const MANUAL_BUDGET = 35_363;

describe('template sizes', () => {
  test(`the manual fits its ${MANUAL_BUDGET}-byte budget`, () => {
    expect(statSync(join(PLUGIN_SOURCE_ROOT, 'templates', 'AGENTS.md')).size).toBeLessThanOrEqual(MANUAL_BUDGET);
  });
});
