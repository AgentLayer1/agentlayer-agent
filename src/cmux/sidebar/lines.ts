/*
 * cmux's sidebar runtime can neither measure a view nor wrap a row, so chips are packed into lines by an estimated
 * width. This file is plain logic (no runtime globals) so it can be tested on its own.
 */

export const CHIP_PADDING = 7;
const CHAR_WIDTH = 7;
const CHIP_EXTRA = CHIP_PADDING * 2 + 4;
// The spacing between chips on a line.
const GAP = 4;

const widthOf = (label: string): number => [...label].length * CHAR_WIDTH + CHIP_EXTRA;

interface Packed<Item> {
  lines: Item[][];
  used: number;
}

/**
 * `items` in order, packed greedily into lines: the first `firstWidth` wide (it shares its row), the rest `width`
 * wide. An item wider than a line gets a line of its own.
 */
export const packLines = <Item>(
  items: readonly Item[],
  label: (item: Item) => string,
  firstWidth: number,
  width: number
): Item[][] =>
  items.reduce<Packed<Item>>(
    ({ lines, used }, item) => {
      const cost = widthOf(label(item));
      const budget = lines.length === 1 ? firstWidth : width;
      const current = lines.at(-1) ?? [];
      return current.length && used + GAP + cost > budget
        ? { lines: [...lines, [item]], used: cost }
        : { lines: [...lines.slice(0, -1), [...current, item]], used: used + (current.length ? GAP : 0) + cost };
    },
    { lines: [[]], used: 0 }
  ).lines;
