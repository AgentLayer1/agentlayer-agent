import { expect, test } from 'bun:test';
import { withAppearanceSetting } from './appearance';

test('sets the appearance and keeps every other setting, in app and beside it', () => {
  const yours = JSON.stringify({
    actions: { manager: { command: 'cmux' } },
    app: { language: 'en' },
    schemaVersion: 1
  });
  expect(JSON.parse(withAppearanceSetting(yours, 'light'))).toEqual({
    actions: { manager: { command: 'cmux' } },
    app: { language: 'en', appearance: 'light' },
    schemaVersion: 1
  });
});

test('replaces an appearance already set', () => {
  const yours = JSON.stringify({ app: { appearance: 'system' } });
  expect(JSON.parse(withAppearanceSetting(yours, 'dark'))).toEqual({ app: { appearance: 'dark' } });
});

test('starts a settings file when there is none', () => {
  expect(JSON.parse(withAppearanceSetting(null, 'light'))).toEqual({ app: { appearance: 'light' } });
});

test('refuses a file that is not a JSON object', () => {
  expect(() => withAppearanceSetting('[1]', 'light')).toThrow("isn't a JSON object");
  expect(() => withAppearanceSetting('{ broken', 'light')).toThrow();
});
