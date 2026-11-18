import { expect, test } from 'bun:test';
import { ANSI, paint, rgbEscape, stripAnsi } from './ansi';

test('a color becomes a 24-bit escape', () => {
  expect(rgbEscape('#B456A8')).toBe('\x1b[38;2;180;86;168m');
});

test('a painted fragment resets at its end, and stripping gives back the text', () => {
  const painted = paint('Oppi', ANSI.bold, rgbEscape('#B456A8'));
  expect(painted).toBe('\x1b[1m\x1b[38;2;180;86;168mOppi\x1b[0m');
  expect(stripAnsi(painted)).toBe('Oppi');
  expect(paint('plain')).toBe('plain');
});
