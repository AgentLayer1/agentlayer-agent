import { expect, test } from 'bun:test';
import { colorsIn, DEFAULT_AGENT_COLORS } from './persona';

test('the first two codes on the Colors line are the primary and the accent', () => {
  expect(colorsIn('- **Colors:** #123abc and #fedcba')).toEqual({ primary: '#123ABC', accent: '#FEDCBA' });
});

test('a note beside the codes is ignored', () => {
  expect(colorsIn('- **Colors:** ocean `#2F7FC1` (primary, from the avatar) · coral `#E0664A` (accent)')).toEqual({
    primary: '#2F7FC1',
    accent: '#E0664A'
  });
});

test('a missing line, an unfilled token or a single color falls back to the default', () => {
  expect(colorsIn('# Identity\n- **Emoji:** 🐙\n')).toEqual(DEFAULT_AGENT_COLORS);
  expect(colorsIn('- **Colors:** {{AGENT_COLORS}}\n')).toEqual(DEFAULT_AGENT_COLORS);
  expect(colorsIn('- **Colors:** `#123ABC`\n- **Note:** #FEDCBA')).toEqual(DEFAULT_AGENT_COLORS);
});
