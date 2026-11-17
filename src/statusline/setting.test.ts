import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { commandCliPath, statusLineDrift, statusLineSetting } from './setting';
import { PLUGIN_NAME } from '@/config';

const dirs: string[] = [];
/** A home's `.claude` folder holding each named settings file. */
const claudeDir = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-setting-'));
  dirs.push(dir);
  Object.entries(files).forEach(([name, content]) => writeFileSync(join(dir, name), content));
  return dir;
};
const settingsFile = (content: string): string => claudeDir({ 'settings.json': content });
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const CLI = resolve('/opt/plugin/src/cli.ts');

describe('statusLineSetting', () => {
  test('runs the given script with bun, double-quoted, forward slashes only', () => {
    expect(statusLineSetting(CLI)).toEqual({
      type: 'command',
      command: 'bun "/opt/plugin/src/cli.ts" statusline'
    });
    expect(statusLineSetting('C:\\Users\\ada\\plugin\\src\\cli.ts').command).toBe(
      'bun "C:/Users/ada/plugin/src/cli.ts" statusline'
    );
  });

  test('refuses a path a shell would expand inside the quotes', () => {
    expect(() => statusLineSetting('/opt/$HOME/src/cli.ts')).toThrow('may not contain');
  });
});

describe('commandCliPath', () => {
  test('reads our own command back, quoted or not, and ignores anything else', () => {
    expect(commandCliPath('bun "/opt/plugin/src/cli.ts" statusline')).toBe('/opt/plugin/src/cli.ts');
    expect(commandCliPath('bun /opt/plugin/src/cli.ts statusline --setting')).toBe('/opt/plugin/src/cli.ts');
    expect(commandCliPath('bun "/opt/scout/bin/scout" statusline')).toBeUndefined();
    expect(commandCliPath('~/.claude/statusline.sh')).toBeUndefined();
  });
});

describe('statusLineDrift', () => {
  test('is silent for no file, no entry, an operator-owned command, a current path, or unparsable JSON', () => {
    expect(statusLineDrift('/nonexistent/.claude', CLI)).toBeUndefined();
    expect(statusLineDrift(settingsFile('{}'), CLI)).toBeUndefined();
    expect(
      statusLineDrift(settingsFile('{"statusLine":{"type":"command","command":"~/.claude/statusline.sh"}}'), CLI)
    ).toBeUndefined();
    expect(statusLineDrift(settingsFile(JSON.stringify({ statusLine: statusLineSetting(CLI) })), CLI)).toBeUndefined();
    expect(statusLineDrift(settingsFile('{not json'), CLI)).toBeUndefined();
  });

  test('names both paths when the command pins another checkout', () => {
    const stale = settingsFile(
      JSON.stringify({ statusLine: statusLineSetting(`/cache/${PLUGIN_NAME}/0.4.4/src/cli.ts`) })
    );
    const drift = statusLineDrift(stale, CLI);
    expect(drift).toContain(`/cache/${PLUGIN_NAME}/0.4.4/src/cli.ts`);
    expect(drift).toContain('/opt/plugin/src/cli.ts');
    expect(drift).toContain(`/${PLUGIN_NAME}:upgrade`);
    expect(drift).toContain('.claude/settings.json');
  });

  test('reads the local file first, as Claude Code does', () => {
    const stale = JSON.stringify({ statusLine: statusLineSetting(`/cache/${PLUGIN_NAME}/0.4.4/src/cli.ts`) });
    const current = JSON.stringify({ statusLine: statusLineSetting(CLI) });
    expect(statusLineDrift(claudeDir({ 'settings.local.json': current, 'settings.json': stale }), CLI)).toBeUndefined();
    expect(statusLineDrift(claudeDir({ 'settings.local.json': stale, 'settings.json': current }), CLI)).toContain(
      '.claude/settings.local.json'
    );
    expect(statusLineDrift(claudeDir({ 'settings.local.json': '{}', 'settings.json': stale }), CLI)).toContain(
      '.claude/settings.json'
    );
  });
});
