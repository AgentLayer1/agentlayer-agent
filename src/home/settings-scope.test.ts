import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asks, mergeSettings, readSettingsFile } from '@/home/settings-scope';

describe('mergeSettings', () => {
  test('combines lists, lets a local scalar win, and replaces the status line and a marketplace entry whole', () => {
    const merged = mergeSettings(
      {
        permissions: { allow: ['a', 'b'] },
        model: 'opus',
        statusLine: { type: 'command', command: 'x', padding: 1 },
        extraKnownMarketplaces: { dev: { source: { source: 'github', repo: 'o/r' }, autoUpdate: true } }
      },
      {
        permissions: { allow: ['b', 'c'] },
        model: 'fable',
        statusLine: { type: 'command', command: 'y' },
        extraKnownMarketplaces: { dev: { source: { source: 'directory', path: '/p' } } }
      }
    );
    expect(merged).toEqual({
      permissions: { allow: ['a', 'b', 'c'] },
      model: 'fable',
      statusLine: { type: 'command', command: 'y' },
      extraKnownMarketplaces: { dev: { source: { source: 'directory', path: '/p' } } }
    });
  });
});

describe('asks', () => {
  test('holds only for a rule in permissions.ask', () => {
    expect(asks({ permissions: { ask: ['Bash(git push *)', 'mcp__acme__send'] } }, 'mcp__acme__send')).toBe(true);
    expect(asks({ permissions: { allow: ['mcp__acme__send'], ask: [] } }, 'mcp__acme__send')).toBe(false);
    expect(asks({}, 'mcp__acme__send')).toBe(false);
  });
});

describe('readSettingsFile', () => {
  test.skipIf(process.getuid?.() === 0)(
    "no file is no settings; a folder that can't be read is an error, never no settings",
    () => {
      const scratch = mkdtempSync(join(tmpdir(), 'settings-read-'));
      const locked = join(scratch, '.claude');
      mkdirSync(locked);
      writeFileSync(join(locked, 'settings.json'), '{"permissions":{"deny":["Read(**/.env)"]}}');
      chmodSync(locked, 0o000);
      try {
        expect(readSettingsFile(join(scratch, 'absent.json'))).toEqual({});
        expect(() => readSettingsFile(join(locked, 'settings.json'))).toThrow("can't be read");
      } finally {
        chmodSync(locked, 0o755);
        rmSync(scratch, { recursive: true, force: true });
      }
    }
  );
});
