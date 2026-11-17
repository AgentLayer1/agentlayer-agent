import { expect, test } from 'bun:test';
import { packLines } from './sidebar/lines';

const same = (label: string) => label;

test('chips fill the first line beside the pill, then wrap onto full-width lines', () => {
  const labels = ['🐙 Oppi', '🦊 Vikram', '🐢 Scout', '🦉 Nova', '🐝 Bea', '🦁 Leo'];
  const lines = packLines(labels, same, 150, 220);
  expect(lines.flat()).toEqual(labels);
  expect(lines.length).toBeGreaterThan(1);
  expect(lines[0]).toEqual(['🐙 Oppi', '🦊 Vikram']);
});

test('one agent stays on the first line, and a chip wider than a line gets one of its own', () => {
  expect(packLines(['🐙 Oppi'], same, 150, 220)).toEqual([['🐙 Oppi']]);
  const long = 'An agent with a very long name indeed';
  expect(packLines(['🐙 Oppi', long, '🦊 Vikram'], same, 150, 220)).toEqual([['🐙 Oppi'], [long], ['🦊 Vikram']]);
  expect(packLines([], same, 150, 220)).toEqual([[]]);
});

test('the gaps between chips count toward a line, so chips that fit with them stay together', () => {
  const labels = ['🦄 Nova', '🦀 Scout', '🦊 Atlas'];
  expect(packLines(labels, same, 214, 276)).toEqual([labels]);
  expect(packLines(labels, same, 213, 276)).toEqual([['🦄 Nova', '🦀 Scout'], ['🦊 Atlas']]);
});
