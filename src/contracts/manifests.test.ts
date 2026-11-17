import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AGENT_SLUG } from '@/config';
import { CLI_FILE, PLUGIN_SOURCE_ROOT } from '@/shared/naming';
import { HOST_FLOORS } from '@/upgrade/hosts';

const ROOT = PLUGIN_SOURCE_ROOT;
const read = (rel: string) => JSON.parse(readFileSync(resolve(ROOT, rel), 'utf-8'));

describe('plugin manifests', () => {
  const claude = read('.claude-plugin/plugin.json');
  const codex = read('.codex-plugin/plugin.json');

  test('the Codex manifest tracks the Claude one: same name, version, description, license', () => {
    for (const field of ['name', 'version', 'description', 'license', 'repository']) {
      expect(codex[field]).toBe(claude[field]);
    }
  });

  test('Claude declares the MCP server and hooks in its manifest; the Codex plugin is skills-only (its MCP server and hooks are per home)', () => {
    expect(codex.skills).toBe('./skills/');
    expect(codex.mcpServers).toBeUndefined();
    expect(claude.mcpServers[AGENT_SLUG].args).toEqual(['${CLAUDE_PLUGIN_ROOT}/src/server.ts']);
    expect(claude.hooks).toBe('./hooks/claude.json');
    expect(existsSync(resolve(ROOT, '.mcp.json'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'hooks', 'hooks.json'))).toBe(false);
    expect(codex.interface.defaultPrompt.length).toBeLessThanOrEqual(3);
  });

  test('the Claude Code range the host enforces is the floor upgrade checks', () => {
    const floor = HOST_FLOORS.find((host) => host.name === 'claude')?.version;
    expect(claude.engines).toEqual({ 'claude-code': `>=${floor}` });
  });

  test('every hook runs the one CLI file', () => {
    const groups: { hooks: { command: string }[] }[][] = Object.values(read('hooks/claude.json').hooks);
    const commands = groups.flat().flatMap((group) => group.hooks.map((hook) => hook.command));
    expect(commands.length).toBeGreaterThan(3);
    commands.forEach((command) => expect(command).toStartWith(`bun "\${CLAUDE_PLUGIN_ROOT}/${CLI_FILE.replaceAll('\\', '/')}" `));
  });

  test('the repo doubles as a Codex marketplace listing this checkout as the plugin', () => {
    const marketplace = read('.agents/plugins/marketplace.json');
    const claudeCatalog = read('.claude-plugin/marketplace.json');
    expect(marketplace.name).toBe(claudeCatalog.name);
    expect(claudeCatalog.plugins).toEqual([expect.objectContaining({ name: claude.name, source: './' })]);
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: claude.name, source: { source: 'local', path: './' } })
    ]);
  });
});
