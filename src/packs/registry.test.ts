import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MCP_PREFIX } from '@/config';
import { readProbe } from './probe';
import { PACKS, PackState, packIds, type Probe, statusOf } from './registry';

const probe = (extra: Partial<Probe> = {}): Probe => ({
  allow: new Set(),
  deny: new Set(),
  env: {},
  secrets: new Set(),
  mcpServers: [],
  exists: () => false,
  libraries: 0,
  cmux: 'not-installed',
  finances: [],
  macos: true,
  cmuxApp: true,
  ...extra
});

const tool = (name: string): string => `${MCP_PREFIX}${name}`;

describe('statusOf', () => {
  test('a home with nothing set up has every pack new, and nothing missing listed', () => {
    const all = packIds().map((id) => statusOf(id, probe()));
    expect(all.every((pack) => pack.state === PackState.New && pack.missing.length === 0)).toBe(true);
  });

  test('a pack with every required part is ready, its optional parts still listed as missing', () => {
    expect(statusOf('browser', probe({ allow: new Set(PACKS.browser.grants.slice(1)) }))).toMatchObject({
      state: PackState.Ready,
      missing: ['Perplexity search key (optional)']
    });
  });

  test('a pack with some of its parts is half-done, naming what is left', () => {
    expect(statusOf('github', probe({ allow: new Set(PACKS.github.grants) }))).toMatchObject({
      state: PackState.Partial,
      missing: ['gh kept out of the shell', 'a GitHub token']
    });
    expect(statusOf('helpdesk', probe({ allow: new Set(PACKS.helpdesk.grants.slice(0, 7)) })).missing).toEqual([
      'a helpdesk login',
      'draft notes and assigning (optional)'
    ]);
  });

  test('SEO granted for one capability is set up: each capability is optional by design', () => {
    expect(statusOf('seo', probe({ allow: new Set([tool('page_speed_audit')]) })).state).toBe(PackState.Ready);
  });

  test('finances is half-done until each company lists its accounts', () => {
    const entities = [
      { slug: 'acme', company: true, accounts: false },
      { slug: 'ada', company: false, accounts: false }
    ];
    expect(statusOf('finances', probe({ finances: entities }))).toMatchObject({
      state: PackState.Partial,
      missing: ["acme's bank accounts", 'categorising rules (RULES.md) (optional)']
    });
  });

  test('Xcode and cmux are offered only on a Mac, cmux only with the app', () => {
    expect(statusOf('xcode', probe({ macos: false })).available).toBe(false);
    expect(statusOf('cmux', probe({ cmuxApp: false })).available).toBe(false);
    expect(statusOf('cmux', probe()).available).toBe(true);
  });

  test("a pack's own MCP server is not one of the operator's remote servers", () => {
    expect(statusOf('mcp', probe({ mcpServers: ['xcode'] })).state).toBe(PackState.New);
    expect(statusOf('mcp', probe({ mcpServers: ['xcode', 'linear'] })).state).toBe(PackState.Ready);
  });
});

describe('readProbe', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  test('reads grants from both settings layers, env, .mcp.json, linked libraries and finance profiles', () => {
    const home = mkdtempSync(join(tmpdir(), 'packs-probe-'));
    dirs.push(home);
    const write = (file: string, body: string): void => {
      mkdirSync(dirname(join(home, file)), { recursive: true });
      writeFileSync(join(home, file), body);
    };
    write('.claude/settings.json', JSON.stringify({ permissions: { allow: ['a'], deny: ['Bash(gh *)'] } }));
    write('.claude/settings.local.json', JSON.stringify({ permissions: { allow: ['b'] }, env: { GSC_SITE_URL: 'x' } }));
    write('.mcp.json', JSON.stringify({ mcpServers: { xcode: {}, linear: {} } }));
    write(
      'projects/finances/entities/acme.md',
      '---\nkind: company\n---\n\n## Accounts\n\n```yaml\n- { id: acme-main }\n```\n'
    );
    write('projects/finances/entities/ada.md', '---\nkind: individual\n---\n');
    write('library/SKILL.md', '# lib\n');
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    symlinkSync(join(home, 'library'), join(home, '.claude/skills/lib'));
    mkdirSync(join(home, '.claude/skills/own'));
    const read = readProbe(home);
    expect([...read.allow].toSorted()).toEqual(['a', 'b']);
    expect(read.deny.has('Bash(gh *)')).toBe(true);
    expect(read.env.GSC_SITE_URL).toBe('x');
    expect(read.mcpServers).toEqual(['xcode', 'linear']);
    expect(read.libraries).toBe(1);
    expect(read.finances).toEqual([
      { slug: 'acme', company: true, accounts: true },
      { slug: 'ada', company: false, accounts: false }
    ]);
  });
});
