import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';
import { isScoped } from '@/shared/weight';

// Every home loads the manual into every session, and Codex reads only its first 32,768 bytes unless a home raises
// the limit, so the budget leaves room for a home's own sections. It only comes down.
const MANUAL_BUDGET = 29_000;
const UNSCOPED_RULE_BUDGET = 6_000;

describe('template sizes', () => {
  test(`the manual fits its ${MANUAL_BUDGET}-byte budget`, () => {
    expect(statSync(join(PLUGIN_SOURCE_ROOT, 'templates', 'AGENTS.md')).size).toBeLessThanOrEqual(MANUAL_BUDGET);
  });

  test(`a rule file with no path scope fits ${UNSCOPED_RULE_BUDGET} bytes`, () => {
    const rules = join(PLUGIN_SOURCE_ROOT, 'templates', 'rules');
    const unscoped = readdirSync(rules).filter((name) => !isScoped(readFileSync(join(rules, name), 'utf-8')));
    expect(unscoped).toEqual(['xcode.md']);
    unscoped.forEach((name) => expect(statSync(join(rules, name)).size).toBeLessThanOrEqual(UNSCOPED_RULE_BUDGET));
  });
});
