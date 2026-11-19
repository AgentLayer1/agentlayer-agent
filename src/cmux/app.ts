import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { compareSemver } from '@/upgrade/version';

// TODO(windows): cmux is a macOS app, so the pack only looks for it in /Applications.
export const CMUX_APP = join('/Applications', 'cmux.app');
export const MIN_CMUX = '0.65.2';
const CMUX_BIN = join(CMUX_APP, 'Contents', 'Resources', 'bin', 'cmux');
const INFO_PLIST = join(CMUX_APP, 'Contents', 'Info.plist');

/**
 * The installed cmux app's version, or `null` when cmux isn't installed.
 */
export const cmuxVersion = (): string | null => {
  if (!existsSync(INFO_PLIST)) {
    return null;
  }
  // plutil reads a plist in XML or binary form alike.
  const read = Bun.spawnSync(['/usr/bin/plutil', '-extract', 'CFBundleShortVersionString', 'raw', INFO_PLIST]);
  return read.exitCode === 0 ? read.stdout.toString().trim() || null : null;
};

export const cmuxTooOld = (version: string): boolean => compareSemver(version, MIN_CMUX) < 0;

/**
 * Runs the cmux CLI with its output passed through. It only answers from a terminal inside cmux.
 */
export const runCmux = (args: string[]): boolean => {
  try {
    return Bun.spawnSync([CMUX_BIN, ...args], { stdout: 'inherit', stderr: 'inherit' }).exitCode === 0;
  } catch {
    return false;
  }
};

export interface CmuxCall {
  ok: boolean;
  /**
   * What cmux printed, both streams.
   */
  output: string;
}

/**
 * Runs the cmux CLI with its output kept, for a caller whose own output is the reply.
 */
export const callCmux = (args: string[]): CmuxCall => {
  try {
    // A cmux that stops answering mustn't hang the /proposal that called it.
    const result = Bun.spawnSync([CMUX_BIN, ...args], { stdout: 'pipe', stderr: 'pipe', timeout: 30_000 });
    return { ok: result.exitCode === 0, output: `${result.stdout}${result.stderr}`.trim() };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
};
