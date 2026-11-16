import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { bundleSidebar, DIST } from './build';
import { hasRuntime, mount } from './runtime-harness';

test('sidebar/dist/sidebar.js is built from the current source', async () => {
  expect(await bundleSidebar(), 'dist is stale: run `bun run cmux:build`').toBe(readFileSync(DIST, 'utf8'));
});

test.skipIf(!hasRuntime)('the built sidebar mounts on cmux’s runtime and draws its title', () => {
  const { visibleTexts } = mount(readFileSync(DIST, 'utf8'));
  expect(visibleTexts()).toEqual(['AgentLayer']);
});
