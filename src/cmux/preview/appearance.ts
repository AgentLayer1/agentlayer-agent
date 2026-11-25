/*
 * cmux has one appearance for the whole app, `app.appearance` in its settings file, and no way to give one window its
 * own.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '@/shared/json-block';
import { writeFileAtomic } from '@/shared/utils';
import { cmux } from './window';

export const APPEARANCES = ['dark', 'light'] as const;
type Appearance = (typeof APPEARANCES)[number];

// cmux redraws its windows about a second after a config reload.
const REDRAW = 1500;

const settingsPath = (): string => join(homedir(), '.config', 'cmux', 'cmux.json');

/**
 * cmux's settings `text` (null when there is no file) with `app.appearance` set and every other key kept. Throws on a
 * file that isn't a JSON object.
 */
export const withAppearanceSetting = (text: string | null, appearance: Appearance): string => {
  const settings: unknown = text === null ? {} : JSON.parse(text);
  if (!isRecord(settings)) {
    throw new Error("cmux's settings file isn't a JSON object; fix it before taking screenshots");
  }
  const app = isRecord(settings.app) ? settings.app : {};
  return `${JSON.stringify({ ...settings, app: { ...app, appearance } }, null, 2)}\n`;
};

/**
 * Runs `body` with `setAppearance` in hand, then puts cmux's settings file back as it was and reloads it.
 */
export const keepingAppearance = async <Result>(
  body: (setAppearance: (appearance: Appearance) => Promise<void>) => Promise<Result>
): Promise<Result> => {
  const path = settingsPath();
  const original = existsSync(path) ? readFileSync(path) : null;
  const text = original === null ? null : original.toString('utf8');
  const settingsFor = { dark: withAppearanceSetting(text, 'dark'), light: withAppearanceSetting(text, 'light') };
  const restore = () => {
    if (original === null) {
      rmSync(path, { force: true });
    } else {
      writeFileAtomic(path, original);
    }
    cmux('reload-config');
  };
  // Bun skips `finally` when a signal ends the process.
  const onSignal = () => {
    restore();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    return await body(async (appearance) => {
      writeFileAtomic(path, settingsFor[appearance]);
      cmux('reload-config');
      await Bun.sleep(REDRAW);
    });
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    restore();
  }
};
