import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readProbe } from './probe';
import { mcp, PACKS, PackState, packIds, type Probe, statusOf } from './registry';

const probe = (extra: Partial<Probe> = {}): Probe => ({
  allow: new Set(),
  deny: new Set(),
  env: {},
  key: () => false,
  signedIn: new Set(),
  connections: { github: 0, database: 0, helpdesk: 0 },
  mcpServers: [],
  exists: () => false,
  libraries: false,
  cmuxJoined: false,
  finances: [],
  macos: true,
  cmuxApp: true,
  inCmux: false,
  ...extra
});

const without = (grants: string[], ...names: string[]): Set<string> =>
  new Set(grants.filter((grant) => !mcp(names).includes(grant)));

describe('statusOf', () => {
  test('a home with nothing set up has every pack new, and nothing missing listed', () => {
    const all = packIds().map((id) => statusOf(id, probe()));
    expect(all.every((pack) => pack.state === PackState.New && pack.missing.length === 0)).toBe(true);
  });

  test('a pack with every required part is ready, its optional parts still off listed apart', () => {
    expect(statusOf('browser', probe({ allow: without(PACKS.browser.grants, 'web_search') }))).toMatchObject({
      state: PackState.Ready,
      missing: [],
      optional: ['Perplexity search key']
    });
  });

  test('a pack with some of its parts is half-done, naming what is left', () => {
    expect(statusOf('github', probe({ allow: new Set(PACKS.github.grants) }))).toMatchObject({
      state: PackState.Partial,
      missing: ['gh kept out of the shell', 'a GitHub token']
    });
    expect(
      statusOf('helpdesk', probe({ allow: without(PACKS.helpdesk.grants, 'helpdesk_note', 'helpdesk_assign') }))
    ).toMatchObject({ missing: ['a helpdesk login'], optional: ['draft notes and assigning'] });
  });

  test('SEO granted for one capability is set up: each capability is optional by design', () => {
    expect(statusOf('seo', probe({ allow: new Set(mcp(['page_speed_audit'])) })).state).toBe(PackState.Ready);
  });

  test('finances is half-done until each company lists its accounts', () => {
    const entities = [
      { slug: 'acme', company: true, accounts: false },
      { slug: 'ada', company: false, accounts: false }
    ];
    expect(statusOf('finances', probe({ finances: entities }))).toMatchObject({
      state: PackState.Partial,
      missing: ["acme's bank accounts"],
      optional: ['categorising rules (RULES.md)']
    });
  });

  test('Xcode and cmux are offered only on a Mac, cmux only with the app', () => {
    expect(statusOf('xcode', probe({ macos: false })).available).toBe(false);
    expect(statusOf('cmux', probe({ cmuxApp: false })).available).toBe(false);
    expect(statusOf('cmux', probe()).available).toBe(true);
  });

  test('Browser is always recommended, GitHub once a code path is set, cmux inside cmux, and nothing else', () => {
    const recommended = (extra: Partial<Probe>) => packIds().filter((id) => statusOf(id, probe(extra)).recommended);
    expect(recommended({})).toEqual(['browser']);
    expect(recommended({ env: { AGENT_CODE_PATH: '/code' }, inCmux: true })).toEqual(['browser', 'github', 'cmux']);
    expect(recommended({ allow: new Set(PACKS.browser.grants) })).toEqual([]);
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
    write(
      'projects/finances/entities/beta.md',
      '---\nname: Beta\n---\n\n## Accounts\n\n## Obligations\n\n```yaml\n- { id: sst, title: SST }\n```\n'
    );
    write('library/SKILL.md', '# lib\n');
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    symlinkSync(join(home, 'library'), join(home, '.claude/skills/lib'));
    mkdirSync(join(home, '.claude/skills/own'));
    const read = readProbe(home);
    expect([...read.allow].toSorted()).toEqual(['a', 'b']);
    expect(read.deny.has('Bash(gh *)')).toBe(true);
    expect(read.env.GSC_SITE_URL).toBe('x');
    expect(read.mcpServers).toEqual(['xcode', 'linear']);
    expect(read.libraries).toBe(true);
    expect(read.finances).toEqual([
      { slug: 'acme', company: true, accounts: true },
      { slug: 'ada', company: false, accounts: false },
      { slug: 'beta', company: true, accounts: false }
    ]);
  });
});
