/*
 * Copied from cmux-custom-manager's preview/screenshot.ts (the upstream copy): running cmux's CLI in a window this
 * script opens and always closes. Change both together.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { crop, decodePng, encodePng, panelRect } from './png';

export interface Step {
  args: string[];
  /**
   * Milliseconds to wait before running it, for cmux to draw what the steps before it changed.
   */
  wait?: number;
}

/**
 * Runs cmux's CLI and returns what it prints; it only answers from a terminal inside cmux.
 */
export const cmux = (...args: string[]): string => {
  const result = Bun.spawnSync(['cmux', ...args], { stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`cmux ${args.join(' ')}: ${result.stderr.toString().trim() || `exit ${result.exitCode}`}`);
  }
  return result.stdout.toString();
};

interface WindowRow {
  id: string;
  ref: string;
}

export const windows = (): WindowRow[] => {
  const listed: unknown = JSON.parse(cmux('rpc', 'window.list', '{}'));
  const rows = typeof listed === 'object' && listed !== null && 'windows' in listed ? listed.windows : [];
  return Array.isArray(rows)
    ? rows.flatMap((row: unknown) =>
        typeof row === 'object' &&
        row !== null &&
        'id' in row &&
        'ref' in row &&
        typeof row.id === 'string' &&
        typeof row.ref === 'string'
          ? [{ id: row.id, ref: row.ref }]
          : []
      )
    : [];
};

export const runSteps = async (steps: readonly Step[]): Promise<void> => {
  for (const { args, wait } of steps) {
    if (wait) {
      await Bun.sleep(wait);
    }
    cmux(...args);
  }
};

/**
 * Runs `body` in a window it opens for the purpose and always closes, so nothing it does can reach the windows that
 * were already open: the new window is the one id that wasn't listed before, and every step names it.
 */
export const inNewWindow = async <Result>(name: string, body: (window: string) => Promise<Result>): Promise<Result> => {
  const before = new Set(windows().map((row) => row.id));
  cmux('new-window', '--name', name);
  const opened = async (tries: number): Promise<string[]> => {
    const fresh = windows()
      .map((row) => row.id)
      .filter((id) => !before.has(id));
    if (fresh.length || tries === 0) {
      return fresh;
    }
    await Bun.sleep(200);
    return opened(tries - 1);
  };
  const fresh = await opened(15);
  const [window] = fresh;
  if (fresh.length !== 1 || !window) {
    throw new Error(
      `expected one new window, found ${fresh.length}; no other window was touched, close any new one by hand`
    );
  }
  try {
    return await body(window);
  } finally {
    cmux('close-window', '--window', window, '--force');
  }
};

/**
 * Writes the right sidebar of the window shot at `full` to `out`, cropped by panelRect.
 */
export const writePanel = (full: string, out: string): void => {
  const image = decodePng(readFileSync(full));
  writeFileSync(out, encodePng(crop(image, panelRect(image))));
};
