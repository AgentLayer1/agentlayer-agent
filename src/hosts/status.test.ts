import { describe, expect, test } from 'bun:test';
import { antigravityHost } from '@/hosts/antigravity';
import { codexHost } from '@/hosts/codex';
import { viewOf, type Registration } from '@/hosts/status';
import type { HostStatus } from '@/upgrade/hosts';

const NONE: Registration = { findings: [], warnings: [] };

const cli = (state: HostStatus['state'], installed: string | null = '0.200.0'): HostStatus => ({
  name: 'codex',
  required: false,
  installed: state === 'absent' ? null : installed,
  floor: '0.154.0',
  why: 'a reason',
  state,
  update: 'npm install -g @openai/codex@latest'
});

describe('viewOf', () => {
  test('a wired host with a current CLI and nothing found is ready, with nothing to do', () => {
    const view = viewOf({ host: codexHost, cli: cli('ok'), wired: true, issues: [] }, NONE);
    expect(view.state).toBe('ready');
    expect(view.todos).toEqual([]);
  });

  test('a CLI below the floor needs the operator, with its update command', () => {
    const view = viewOf({ host: codexHost, cli: cli('outdated', '0.100.0'), wired: true, issues: [] }, NONE);
    expect(view.state).toBe('needs-you');
    expect(view.todos).toEqual([
      {
        text: 'codex 0.100.0 is older than the 0.154.0 the plugin needs',
        commands: ['npm install -g @openai/codex@latest']
      }
    ]);
  });

  test('an installed host the home is not wired for is not set up, and says how to set it up', () => {
    const view = viewOf({ host: codexHost, cli: cli('ok'), wired: false, issues: [] }, NONE);
    expect(view.state).toBe('not-set-up');
    expect(view.todos).toEqual([{ text: codexHost.setup, commands: [] }]);
  });

  test('a host neither installed nor wired is only not installed', () => {
    const view = viewOf({ host: antigravityHost, cli: cli('absent'), wired: false, issues: [] }, NONE);
    expect(view.state).toBe('not-installed');
    expect(view.todos).toEqual([]);
  });

  test('a wired host whose CLI is missing needs the operator', () => {
    const view = viewOf({ host: codexHost, cli: cli('absent'), wired: true, issues: [] }, NONE);
    expect(view.state).toBe('needs-you');
    expect(view.todos[0]?.text).toContain("isn't on your PATH");
  });

  test("a registration finding becomes the host's to-do with its commands, and no other host's", () => {
    const registration: Registration = {
      findings: [{ host: 'codex', detail: "Codex's copy is old.", commands: ['codex plugin add acme@acme'] }],
      warnings: []
    };
    const codex = viewOf({ host: codexHost, cli: cli('ok'), wired: true, issues: [] }, registration);
    const antigravity = viewOf({ host: antigravityHost, cli: cli('ok'), wired: true, issues: [] }, registration);
    expect(codex.state).toBe('needs-you');
    expect(codex.todos).toEqual([{ text: "Codex's copy is old.", commands: ['codex plugin add acme@acme'] }]);
    expect(antigravity.state).toBe('ready');
  });

  test('a machine or home issue on a wired host needs the operator', () => {
    const view = viewOf(
      { host: antigravityHost, cli: cli('ok'), wired: true, issues: ["Antigravity's terminal sandbox is off."] },
      NONE
    );
    expect(view.state).toBe('needs-you');
    expect(view.todos).toEqual([{ text: "Antigravity's terminal sandbox is off.", commands: [] }]);
  });
});
