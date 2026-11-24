import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { RULE_FILE, renderRule } from '@/hosts/antigravity-rule';

test('the shipped Antigravity rule is the adapter glossary, current (bun src/hosts/antigravity-rule.ts sync)', () => {
  expect(readFileSync(RULE_FILE, 'utf-8')).toBe(renderRule());
});

test('the rule names no machine path, since it ships in the repo', () => {
  expect(renderRule()).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\/);
});
