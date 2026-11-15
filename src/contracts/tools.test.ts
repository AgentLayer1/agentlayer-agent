import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_PREFIX } from '@/config';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';
import type { ToolDef } from '@/shared/tool-def';
import { TOOLS } from '@/tools';

const SRC = join(PLUGIN_SOURCE_ROOT, 'src');

describe('the tool registry', () => {
  test('every tool name is unique', () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(names.length).toBeGreaterThan(80);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  test("every domain's tool.ts is registered", async () => {
    const files = [...new Bun.Glob('*/tool.ts').scanSync(SRC)];
    expect(files.length).toBeGreaterThan(10);
    const unregistered = await Promise.all(
      files.map(async (file) => {
        const { tools } = (await import(join(SRC, file))) as { tools: ToolDef[] };
        return tools.filter((tool) => !TOOLS.includes(tool)).map((tool) => `${file}: ${tool.name}`);
      })
    );
    expect(unregistered.flat()).toEqual([]);
  });

  test("the tools that only run behind a prompt are exactly init's baseline ask list", () => {
    const init = readFileSync(join(PLUGIN_SOURCE_ROOT, 'skills', 'init', 'SKILL.md'), 'utf-8');
    const block = init.split('Baseline `permissions.ask`')[1]?.match(/```json\n([\s\S]*?)\n```/)?.[1];
    if (block === undefined) {
      throw new Error("init's SKILL.md has no baseline permissions.ask block");
    }
    const asked = (JSON.parse(block) as string[]).filter((rule) => rule.startsWith(MCP_PREFIX)).map((rule) => rule.slice(MCP_PREFIX.length));
    const askOnly = TOOLS.filter((tool) => tool.askOnly).map((tool) => tool.name);
    expect(askOnly.length).toBeGreaterThan(0);
    expect(askOnly.toSorted()).toEqual(asked.toSorted());
  });
});
