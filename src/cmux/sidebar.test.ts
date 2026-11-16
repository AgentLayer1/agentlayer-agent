import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { bundleSidebar, DIST } from './build';
import { renderSidebar } from './file';
import { CMUX_DATA, fixtureEntry, NOVA } from './preview/fixture';
import { previewText } from './preview/preview';
import { hasRuntime, mount } from './runtime-harness';

const run = test.skipIf(!hasRuntime);

const installed = () =>
  renderSidebar({
    version: '1.1.0',
    homes: { [NOVA.runtime.home]: fixtureEntry(NOVA) },
    bundle: readFileSync(DIST, 'utf8')
  });

test('sidebar/dist/sidebar.js is built from the current source', async () => {
  expect(await bundleSidebar(), 'dist is stale: run `bun run cmux:build`').toBe(readFileSync(DIST, 'utf8'));
});

run('the sidebar draws the Manager over cmux’s sessions', () => {
  const texts = mount(installed(), CMUX_DATA).visibleTexts();
  expect(texts[0]).toBe('Manager');
  expect(texts).toEqual(expect.arrayContaining(['Support sweep', 'Fix the checkout total']));
});

run('the preview draws invented sessions on its own, and its taps go nowhere', () => {
  const preview = mount(previewText({ version: '1.1.0', bundle: readFileSync(DIST, 'utf8') }));
  expect(preview.visibleTexts()).toContain('Support sweep');
  expect(preview.tap('Support sweep')).toBeUndefined();
});
