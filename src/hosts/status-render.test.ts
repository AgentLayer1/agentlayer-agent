import { describe, expect, test } from 'bun:test';
import { CAPABILITIES } from '@/hosts/contract';
import { HOSTS } from '@/hosts/registry';
import { viewOf, type HostsOverview } from '@/hosts/status';
import { renderHosts } from '@/hosts/status-render';
import { stripAnsi } from '@/shared/ansi';

const overview: HostsOverview = {
  home: '/tmp/acme/Nova',
  hosts: HOSTS.map((host) =>
    viewOf(
      {
        host,
        cli: {
          name: host.name,
          required: false,
          installed: host.name === 'antigravity' ? null : '9.9.9',
          floor: '1.0.0',
          why: 'a reason',
          state: host.name === 'antigravity' ? 'absent' : 'ok',
          update: 'update it'
        },
        wired: host.name !== 'antigravity',
        issues: []
      },
      {
        findings: [{ host: 'codex', detail: "Codex's copy is old.", commands: ['codex plugin add acme@acme'] }],
        warnings: []
      }
    )
  ),
  warnings: []
};

const plain = renderHosts(overview, { version: '1.2.3', width: 60, color: false });
const lines = plain.split('\n');

describe('renderHosts', () => {
  test('the matrix has a row per capability with a mark per host, and fits a narrow window', () => {
    const rows = CAPABILITIES.map(({ label }) => lines.find((line) => line.startsWith(label)));
    expect(rows.every((row) => row !== undefined && row.length <= 40)).toBe(true);
    expect(lines.find((line) => line.startsWith('Mods'))?.match(/[✓◐✗]/g)).toEqual(['✓', '✗', '✗']);
    expect(lines.find((line) => line.startsWith('Agent tools'))?.match(/[✓◐✗]/g)).toEqual(['✓', '◐', '◐']);
  });

  test('each host gets a section with its state, its gaps and its to-dos with their commands', () => {
    expect(plain).toContain('● Claude Code');
    expect(lines.find((line) => line.startsWith('● Codex'))).toEndWith('needs you');
    expect(plain).toContain("→ Codex's copy is old.");
    expect(plain).toContain('$ codex plugin add acme@acme');
    expect(plain).toContain('✗ Mods:');
  });

  test('a host that is not installed is one line, with no detail under it', () => {
    const at = lines.findIndex((line) => line.startsWith('○ Antigravity'));
    expect(lines[at]).toEndWith('not installed');
    expect(lines[at + 1] ?? '').toBe('');
  });

  test('colour is escape codes only: without it the text is the same, with no escapes', () => {
    const colored = renderHosts(overview, { version: '1.2.3', width: 60, color: true });
    expect(colored).toContain('\x1b[');
    expect(plain).not.toContain('\x1b[');
    expect(stripAnsi(colored)).toBe(plain);
  });
});
