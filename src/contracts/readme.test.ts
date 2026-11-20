import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';
import { TOOLS } from '@/tools';

const README = readFileSync(join(PLUGIN_SOURCE_ROOT, 'README.md'), 'utf-8');
const SKILLS = join(PLUGIN_SOURCE_ROOT, 'skills');

const skills = readdirSync(SKILLS).filter((name) => existsSync(join(SKILLS, name, 'SKILL.md')));
const playbooks = skills.flatMap((name) => {
  const dir = join(SKILLS, name, 'references', 'playbooks');
  return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.md')) : [];
});

const stated = (pattern: RegExp): number => Number(README.match(pattern)?.[1]);

describe("the README's counts", () => {
  test('match the skills, playbooks and tools the plugin ships', () => {
    expect(skills.length).toBeGreaterThan(30);
    expect({
      skills: stated(/\*\*(\d+) \[skills\]/),
      playbooks: stated(/(\d+) playbooks/),
      tools: stated(/\*\*(\d+) \[MCP tools\]/)
    }).toEqual({ skills: skills.length, playbooks: playbooks.length, tools: TOOLS.length });
  });
});
