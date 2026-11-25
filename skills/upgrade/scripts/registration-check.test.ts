import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'registration-check.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A machine: a plugin checkout whose catalogs say `agentdev-scout`, a home, and empty host dirs. */
const machine = () => {
  const root = mkdtempSync(join(tmpdir(), 'registration-'));
  dirs.push(root);
  const write = (rel: string, value: unknown | string) => {
    const path = join(root, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('plugin/.claude-plugin/plugin.json', { name: 'agent-scout', version: '0.4.1' });
  write('plugin/.claude-plugin/marketplace.json', { name: 'agentdev-scout', plugins: [] });
  write('plugin/.agents/plugins/marketplace.json', { name: 'agentdev-scout', plugins: [] });
  mkdirSync(join(root, 'home', '.claude'), { recursive: true });
  mkdirSync(join(root, 'claude', 'plugins'), { recursive: true });
  mkdirSync(join(root, 'codex'), { recursive: true });
  mkdirSync(join(root, 'gemini'), { recursive: true });
  const run = () => {
    const proc = spawnSync(
      process.execPath,
      [
        SCRIPT,
        '--home',
        join(root, 'home'),
        '--plugin-root',
        join(root, 'plugin'),
        '--claude-dir',
        join(root, 'claude'),
        '--codex-dir',
        join(root, 'codex'),
        '--gemini-dir',
        join(root, 'gemini')
      ],
      { encoding: 'utf-8' }
    );
    if (proc.status !== 0) throw new Error(proc.stderr);
    return JSON.parse(proc.stdout);
  };
  return { root, write, run };
};

describe('registration-check', () => {
  test('a clean machine has nothing to do', () => {
    const { write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      'agentdev-scout': { source: { source: 'directory', path: 'x' } }
    });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@agentdev-scout': true } });
    expect(run()).toMatchObject({ plugin: 'agent-scout', ok: true, findings: [], settings: {} });
  });

  test('a checkout registered under a name its catalog no longer carries: re-register, and flip both settings keys', () => {
    const { root, write, run } = machine();
    const checkout = join(root, 'plugin');
    write('claude/plugins/known_marketplaces.json', { scoutco: { source: { source: 'directory', path: checkout } } });
    write('claude/plugins/installed_plugins.json', { plugins: { 'agent-scout@scoutco': [{ scope: 'project' }] } });
    write('home/.claude/settings.json', {
      enabledPlugins: { 'agent-scout@scoutco': true },
      extraKnownMarketplaces: { scoutco: { source: { source: 'directory', path: checkout } } }
    });
    const result = run();
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({
        host: 'claude',
        kind: 'renamed-catalog',
        commands: [
          '/plugin marketplace remove scoutco',
          `/plugin marketplace add ${checkout}`,
          '/plugin install agent-scout@agentdev-scout'
        ]
      })
    ]);
    expect(result.settings).toEqual({
      enabledPlugins: { from: 'agent-scout@scoutco', to: 'agent-scout@agentdev-scout' },
      extraKnownMarketplaces: { from: 'scoutco', to: 'agentdev-scout' }
    });
  });

  test('a dev checkout and the published marketplace both registered: the key the home already uses stays', () => {
    const { root, write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      agentlayer: { source: { source: 'github', repo: 'AgentLayer1/agentlayer-agent-marketplace' } },
      'agentdev-scout': { source: { source: 'directory', path: join(root, 'plugin') } }
    });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@agentdev-scout': true } });
    expect(run()).toMatchObject({ ok: true, settings: {} });
  });

  test('a key naming a marketplace that is not registered at all flips to the one that is', () => {
    const { root, write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      'agentdev-scout': { source: { source: 'directory', path: join(root, 'plugin') } }
    });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@scoutco': true } });
    expect(run()).toMatchObject({
      ok: false,
      settings: { enabledPlugins: { from: 'agent-scout@scoutco', to: 'agent-scout@agentdev-scout' } }
    });
  });

  test('finds the key in settings.local.json, where the plugin keys now live', () => {
    const { root, write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      'agentdev-scout': { source: { source: 'directory', path: join(root, 'plugin') } }
    });
    write('home/.claude/settings.local.json', { enabledPlugins: { 'agent-scout@scoutco': true } });
    expect(run().settings).toEqual({
      enabledPlugins: { from: 'agent-scout@scoutco', to: 'agent-scout@agentdev-scout' }
    });
  });

  test('a retired marketplace repo: add the new one, nothing in the home changes', () => {
    const { write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      agentlayer: { source: { source: 'github', repo: 'AgentLayer1/agentlayer-claude-marketplace' } }
    });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@agentlayer': true } });
    const result = run();
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: 'retired-marketplace',
        commands: [
          '/plugin marketplace add AgentLayer1/agentlayer-agent-marketplace',
          '/plugin install agent-scout@agentlayer'
        ]
      })
    ]);
    expect(result.settings).toEqual({});
  });

  test('a retired repo registered under another name moves the home key to the published name', () => {
    const { write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      'old-al': { source: { source: 'github', repo: 'AgentLayer1/agentlayer-claude-marketplace' } }
    });
    write('claude/plugins/installed_plugins.json', { plugins: { 'agent-scout@old-al': [{ scope: 'project' }] } });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@old-al': true } });
    const result = run();
    expect(result.findings[0].commands).toEqual([
      '/plugin marketplace add AgentLayer1/agentlayer-agent-marketplace',
      '/plugin install agent-scout@agentlayer'
    ]);
    expect(result.settings.enabledPlugins).toEqual({ from: 'agent-scout@old-al', to: 'agent-scout@agentlayer' });
  });

  test('a dangling key flips to the marketplace the plugin is installed from, not the first registered', () => {
    const { root, write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      agentlayer: { source: { source: 'github', repo: 'AgentLayer1/agentlayer-agent-marketplace' } },
      'agentdev-scout': { source: { source: 'directory', path: join(root, 'plugin') } }
    });
    write('claude/plugins/installed_plugins.json', {
      plugins: { 'agent-scout@agentdev-scout': [{ scope: 'project' }] }
    });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@gone': true } });
    expect(run().settings.enabledPlugins).toEqual({ from: 'agent-scout@gone', to: 'agent-scout@agentdev-scout' });
  });

  test('a registry that does not parse is a warning, and a null entry is skipped', () => {
    const { write, run } = machine();
    write('claude/plugins/known_marketplaces.json', '{ nope');
    write('codex/config.toml', 'model = [\n');
    const result = run();
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(2);
    write('claude/plugins/known_marketplaces.json', { agentlayer: null });
    expect(run().ok).toBe(true);
  });

  test('a Codex local marketplace registered under a stale name', () => {
    const { root, write, run } = machine();
    const checkout = join(root, 'plugin');
    write(
      'codex/config.toml',
      `[marketplaces.scoutco]\nsource_type = "local"\nsource = "${checkout}"\n\n[plugins."agent-scout@scoutco"]\nenabled = true\n`
    );
    const result = run();
    expect(result.findings).toEqual([
      expect.objectContaining({
        host: 'codex',
        commands: [
          'codex plugin remove agent-scout@scoutco',
          'codex plugin marketplace remove scoutco',
          `codex plugin marketplace add ${checkout}`,
          'codex plugin add agent-scout@agentdev-scout'
        ]
      })
    ]);
  });

  test('a home wired for Codex whose Codex has no copy of the plugin', () => {
    const { root, write, run } = machine();
    write('home/.codex/hooks.json', { hooks: {} });
    write('codex/config.toml', '[plugins."agent-other@elsewhere"]\nenabled = true\n');
    expect(run().findings).toEqual([
      expect.objectContaining({
        host: 'codex',
        kind: 'not-installed',
        commands: [
          'codex plugin marketplace add AgentLayer1/agentlayer-agent-marketplace',
          'codex plugin add agent-scout@agentlayer'
        ]
      })
    ]);
    mkdirSync(join(root, 'plugin', '.git'));
    expect(run().findings[0].commands).toEqual([
      `codex plugin marketplace add ${join(root, 'plugin')}`,
      'codex plugin add agent-scout@agentdev-scout'
    ]);
    write('codex/config.toml', '[plugins."agent-scout@agentdev-scout"]\nenabled = true\n');
    expect(run().ok).toBe(true);
  });

  test("Codex's copy of the plugin is an older version than the plugin: remove and add it again", () => {
    const { root, write, run } = machine();
    write('home/.codex/hooks.json', { hooks: {} });
    write('codex/config.toml', '[plugins."agent-scout@agentdev-scout"]\nenabled = true\n');
    mkdirSync(join(root, 'codex', 'plugins', 'cache', 'agentdev-scout', 'agent-scout', '0.3.0'), { recursive: true });
    write('codex/plugins/cache/agentdev-scout/agent-scout/.DS_Store', '');
    expect(run().findings).toEqual([
      expect.objectContaining({
        host: 'codex',
        kind: 'stale-copy',
        detail: expect.stringContaining('copy of agent-scout@agentdev-scout is 0.3.0, and this plugin is 0.4.1'),
        commands: ['codex plugin remove agent-scout@agentdev-scout', 'codex plugin add agent-scout@agentdev-scout']
      })
    ]);
    write(
      'codex/config.toml',
      '[marketplaces.agentdev-scout]\nsource_type = "git"\nsource = "acme/scout"\n\n[plugins."agent-scout@agentdev-scout"]\nenabled = true\n'
    );
    expect(run().findings[0].commands[0]).toBe('codex plugin marketplace upgrade agentdev-scout');
    mkdirSync(join(root, 'codex', 'plugins', 'cache', 'agentdev-scout', 'agent-scout', '0.4.1'));
    expect(run().ok).toBe(true);
  });
});

describe('registration-check for Antigravity', () => {
  const antigravity = (run: () => { findings: { host: string; kind: string; commands: string[] }[] }) =>
    run()
      .findings.filter((finding) => finding.host === 'antigravity')
      .map((finding) => [finding.kind, finding.commands]);

  test('a personal manifest naming another checkout of the plugin, and an installed copy beside it, are reported', () => {
    const { root, write, run } = machine();
    write('old-checkout/.antigravity-plugin/plugin.json', { name: 'agent-scout' });
    write('gemini/config/plugins.json', { entries: [{ path: join(root, 'old-checkout') }] });
    write('gemini/config/plugins/agent-scout/plugin.json', { name: 'agent-scout' });
    expect(antigravity(run)).toEqual([
      ['stale-path', []],
      ['global-copy', ['agy plugin uninstall agent-scout']]
    ]);
  });

  test('a missing path proves nothing: a warning, never a stale checkout or an uninstall', () => {
    const { root, write, run } = machine();
    write('gemini/config/plugins.json', { entries: [{ path: join(root, 'removed-acme-plugin') }] });
    write('gemini/config/plugins/agent-scout/plugin.json', { name: 'agent-scout' });
    const result = run() as { findings: { host: string; kind: string; commands: string[] }[]; warnings: string[] };
    expect(antigravity(() => result)).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining('removed-acme-plugin')]);
  });

  test('a manifest naming this checkout, or no manifest, is fine', () => {
    const current = machine();
    current.write('gemini/config/plugins.json', { entries: [{ path: join(current.root, 'plugin') }] });
    expect(antigravity(current.run)).toEqual([]);
    expect(antigravity(machine().run)).toEqual([]);
  });
});
