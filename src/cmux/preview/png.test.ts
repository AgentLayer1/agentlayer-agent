import { expect, test } from 'bun:test';
import { decorateSteps, WORKSPACES } from './demo';
import { crop, decodePng, encodePng, panelRect, type Image } from './png';
import { setupSteps, shotSteps } from './shot';

// A made-up window: a terminal on the left, the panel on the right with a mode bar across its top.
const madeUpShot = (): Image => {
  const [width, height] = [400, 300];
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = x < 300 ? [47, 47, 55] : y < 20 ? [60, 60, 70] : [34, 34, 39];
      pixels.set([...color, 255], (y * width + x) * 4);
    }
  }
  return { width, height, pixels };
};

test('a PNG survives being written and read back', () => {
  const image = madeUpShot();
  expect(decodePng(encodePng(image))).toEqual(image);
});

test("the panel starts at its edge, below the mode bar, and stops above the window's corner", () => {
  const image = madeUpShot();
  const rect = panelRect(image);
  expect(rect).toEqual({ x: 300, y: 20, width: 100, height: 300 - 20 - 32 });
  expect([...crop(image, rect).pixels.subarray(0, 4)]).toEqual([34, 34, 39, 255]);
});

test('a shot with no clear panel edge is refused, not cropped somewhere', () => {
  const flat: Image = { width: 50, height: 50, pixels: new Uint8Array(50 * 50 * 4).fill(40) };
  expect(() => panelRect(flat)).toThrow('no panel edge found');
});

test('every step that acts on a window names the one the script opened, and only it', () => {
  const window = 'window-under-test';
  const steps = [
    ...setupSteps(window, 'agentlayer-preview'),
    ...shotSteps(window, 'agentlayer-preview', '/tmp/full.png'),
    ...WORKSPACES.flatMap((demo) => decorateSteps(window, 'workspace:1', demo))
  ];
  // Reloading the preview acts on that sidebar's file, wherever it's shown, not on a window.
  const onWindows = steps.filter(({ args }) => args[0] !== 'sidebar');
  expect(steps.length - onWindows.length).toBe(1);
  expect(onWindows.every(({ args }) => args[args.indexOf('--window') + 1] === window)).toBe(true);
  expect(onWindows.every(({ args }) => args.filter((arg) => arg === '--window').length === 1)).toBe(true);
});
