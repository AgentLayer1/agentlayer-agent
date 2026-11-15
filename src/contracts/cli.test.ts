import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI_PATH, HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';

/** A marked home under a fresh temp root, with a settings env block. */
const fixtureHome = (env: Record<string, string>): string => {
  const home = mkdtempSync(join(tmpdir(), 'cli-home-'));
  mkdirSync(join(home, RUNTIME_DIR), { recursive: true });
  writeFileSync(join(home, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.local.json'), JSON.stringify({ env }));
  return home;
};

/** Runs the CLI with only the variables a shell would carry, so the parent test's AGENT_* values can't leak in. */
const cli = (args: string[], options: { cwd: string; env?: Record<string, string> }): string => {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_')));
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd,
    env: { ...inherited, ...options.env },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
};

describe('the CLI', () => {
  test("a home named by AGENT_HOME is read with its own settings, not the cwd's", () => {
    const home = fixtureHome({ AGENT_TIMEZONE: 'Pacific/Auckland' });
    const elsewhere = mkdtempSync(join(tmpdir(), 'cli-elsewhere-'));
    mkdirSync(join(elsewhere, '.claude'), { recursive: true });
    writeFileSync(join(elsewhere, '.claude', 'settings.local.json'), JSON.stringify({ env: { AGENT_TIMEZONE: 'America/Chicago' } }));
    const ping = JSON.parse(cli(['ping'], { cwd: elsewhere, env: { AGENT_HOME: home } })) as { timezone: string; home: string };
    expect(ping.timezone).toBe('Pacific/Auckland');
  });

  test('a mistyped AGENT_TIMEZONE falls back to a real zone instead of breaking every date', () => {
    const home = fixtureHome({ AGENT_TIMEZONE: 'Asia/KualaLumpur' });
    const ping = JSON.parse(cli(['ping'], { cwd: home })) as { timezone: string };
    expect(ping.timezone).not.toBe('Asia/KualaLumpur');
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: ping.timezone })).not.toThrow();
    expect(JSON.parse(cli(['capture', 'a dated note'], { cwd: home }))).toMatchObject({ kind: 'inbox' });
  });

  test('capture keeps a note that starts with --', () => {
    const home = fixtureHome({});
    cli(['capture', '--no-verify skips the hooks; never use it', '--kind=feedback'], { cwd: home });
    expect(readFileSync(join(home, 'knowledge', 'raw', 'user', 'feedback.md'), 'utf-8')).toContain('--no-verify skips the hooks');
  });
});
