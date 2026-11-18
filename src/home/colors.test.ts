import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripAnsi } from '@/shared/ansi';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';
import { colorsIn, DEFAULT_AGENT_COLORS } from '@/shared/persona';
import { colorChoices, colorsLine, colorsLineFor, PALETTES } from './colors';

const luminance = (hex: string): number => {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (one: string, two: string): number => {
  const [light = 0, dark = 0] = [luminance(one), luminance(two)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

test('every offered color reads on a light and on a dark terminal', () => {
  PALETTES.flatMap(({ primary, accent }) => [primary, accent]).forEach((color) => {
    expect(contrast(color, '#FFFFFF')).toBeGreaterThanOrEqual(2.5);
    expect(contrast(color, '#1E1E1E')).toBeGreaterThanOrEqual(2.5);
  });
});

test('the four pairs are listed in order, Oppi’s first, each name in its own colors', () => {
  const rows = colorChoices(DEFAULT_AGENT_COLORS);
  expect(rows.map(stripAnsi)).toEqual([
    "  ████ 1  Orchid & mint  Oppi's",
    '  ████ 2  Ocean & coral',
    '  ████ 3  Crimson & gold',
    '  ████ 4  Amber & teal'
  ]);
  expect(rows[0]).toContain('\x1b[38;2;180;86;168mOrchid');
  expect(rows[0]).toContain('\x1b[38;2;59;170;112mmint');
});

test('a custom pair is shown first as the current one', () => {
  const rows = colorChoices({ primary: '#123ABC', accent: '#FEDCBA' }).map(stripAnsi);
  expect(rows[0]).toBe('  ████ now  #123ABC & #FEDCBA');
  expect(rows).toHaveLength(5);
});

test('a choice becomes the line the parser reads back', () => {
  PALETTES.forEach((palette, index) => {
    const line = colorsLineFor(String(index + 1)) ?? '';
    expect(colorsIn(`- **Colors:** ${line}`)).toEqual({ primary: palette.primary, accent: palette.accent });
  });
  expect(colorsLineFor('2')).toBe('ocean `#2F7FC1` (primary) · coral `#E0664A` (accent)');
  expect(colorsLineFor(' #123abc  #fedcba ')).toBe('primary `#123ABC` (primary) · accent `#FEDCBA` (accent)');
  expect(colorsLine({ primary: '#B456A8', accent: '#3BAA70' })).toBe(
    'orchid `#B456A8` (primary) · mint `#3BAA70` (accent)'
  );
});

test('anything but a pair number or two codes is refused', () => {
  ['0', '5', '', 'orchid', '#123ABC', '#123ABC #FEDCBA #000000', '#12345 #FEDCBA'].forEach((choice) =>
    expect(colorsLineFor(choice)).toBeUndefined()
  );
});

test('init labels each pair with its squares and name', () => {
  const init = readFileSync(join(PLUGIN_SOURCE_ROOT, 'skills', 'init', 'SKILL.md'), 'utf-8');
  PALETTES.forEach(({ squares, primaryName, accentName }) =>
    expect(init).toContain(`${squares} ${primaryName.charAt(0).toUpperCase()}${primaryName.slice(1)} & ${accentName}`)
  );
  expect(readFileSync(join(PLUGIN_SOURCE_ROOT, 'templates', 'IDENTITY.md'), 'utf-8')).toContain(
    '- **Colors:** {{AGENT_COLORS}}'
  );
});
