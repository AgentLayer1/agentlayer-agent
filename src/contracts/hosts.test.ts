import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MCP_PREFIX } from '@/config';
import { HOST_NAMES } from '@/hosts/contract';
import { DIALECT } from '@/hosts/dialect';
import { HOSTS } from '@/hosts/registry';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';
import { TOOLS } from '@/tools';
import { MOD_FEATURES } from '../../mods/shared/catalog';

const ROOT = PLUGIN_SOURCE_ROOT;
const SKILLS = join(ROOT, 'skills');

const filesUnder = (dir: string, pattern: string): string[] =>
  [...new Bun.Glob(pattern).scanSync(dir)].map((rel) => join(dir, rel));

const HOST_NEUTRAL_FILES = [
  ...filesUnder(join(ROOT, 'src', 'hooks'), '**/*.ts').filter((path) => !path.endsWith('.test.ts')),
  join(ROOT, 'src', 'knowledge', 'session-capture.ts'),
  join(ROOT, 'src', 'upgrade', 'hosts.ts')
];

const quoted = HOST_NAMES.map((name) => `'${name}'`).join('|');
const HOST_COMPARISON = new RegExp(`[!=]==\\s*(${quoted})|(${quoted})\\s*[!=]==|(${quoted})\\s*\\|\\s*(${quoted})`);

const skillTexts = filesUnder(SKILLS, '**/*.md').map((path) => ({
  file: relative(ROOT, path),
  text: readFileSync(path, 'utf-8')
}));
const skillDirs = readdirSync(SKILLS).filter((entry) => existsSync(join(SKILLS, entry, 'SKILL.md')));

const CLAUDE_ONLY_TOOLS = [
  'Agent',
  'AskUserQuestion',
  'Artifact',
  'CronCreate',
  'EnterPlanMode',
  'ExitPlanMode',
  'Monitor',
  'NotebookEdit',
  'ScheduleWakeup',
  'Skill',
  'TaskCreate',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Workflow'
];
const PORTABLE_TOOLS = ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'];
const EXAMPLE_TOOLS = ['foo'];

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

const allowedTools = (file: string): string[] => {
  const block = readFileSync(file, 'utf-8').match(FRONTMATTER_RE)?.[1];
  const parsed: unknown = block === undefined ? undefined : Bun.YAML.parse(block);
  if (typeof parsed !== 'object' || parsed === null || !('allowed-tools' in parsed)) {
    return [];
  }
  const value = parsed['allowed-tools'];
  const entries = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value.map(String) : [];
  return entries.map((entry) => entry.trim().replace(/\(.*$/, '')).filter(Boolean);
};

describe('host contract', () => {
  test('the hook layer takes an adapter: no host name is compared inside it', () => {
    expect(HOST_NEUTRAL_FILES.length).toBeGreaterThan(5);
    const offenders = HOST_NEUTRAL_FILES.flatMap((file) =>
      readFileSync(file, 'utf-8')
        .split('\n')
        .flatMap((line, index) =>
          HOST_COMPARISON.test(line) ? [`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`] : []
        )
    );
    expect(offenders).toEqual([]);
  });

  test('every adapter is registered under a name of its own', () => {
    expect(HOSTS.map((host) => host.name)).toEqual([...HOST_NAMES]);
  });

  test("every Claude Code tool a skill names is spelled in every other host's glossary", () => {
    expect(skillDirs.length).toBeGreaterThanOrEqual(37);
    const unclassified = skillDirs
      .flatMap((skill) => allowedTools(join(SKILLS, skill, 'SKILL.md')).map((tool) => ({ skill, tool })))
      .filter(
        ({ tool }) => !tool.startsWith('mcp__') && !PORTABLE_TOOLS.includes(tool) && !CLAUDE_ONLY_TOOLS.includes(tool)
      );
    expect(unclassified).toEqual([]);

    const named = CLAUDE_ONLY_TOOLS.filter((tool) => {
      const mention = new RegExp(`\`${tool}[\`(]|allowed-tools:.*\\b${tool}\\b`);
      return skillTexts.some(({ text }) => mention.test(text));
    });
    expect(named.length).toBeGreaterThanOrEqual(5);
    const spelled = Object.values(DIALECT).join('\n');
    expect(named.filter((tool) => !new RegExp(`\\b${tool}\\b`).test(spelled))).toEqual([]);
  });

  test('every agent tool a skill names by its Claude Code id is one the plugin registers', () => {
    const known = new Set([
      ...TOOLS.map((tool) => tool.name),
      ...MOD_FEATURES.flatMap((feature) => feature.tools),
      ...EXAMPLE_TOOLS
    ]);
    const ids = new RegExp(`${MCP_PREFIX}([A-Za-z0-9_*]+)`, 'g');
    const references = skillTexts.flatMap(({ file, text }) =>
      [...text.matchAll(ids)].map((match) => ({ file, tool: match[1] ?? '' }))
    );
    expect(references.length).toBeGreaterThan(100);
    const matches = (tool: string) =>
      tool.includes('*') ? [...known].some((name) => name.startsWith(tool.replace(/\*.*$/, ''))) : known.has(tool);
    expect(references.filter(({ tool }) => !matches(tool))).toEqual([]);
  });

  test('no skill calls a tool only a Claude Code mod provides', () => {
    const modTools = MOD_FEATURES.flatMap((feature) => feature.tools);
    expect(modTools.length).toBeGreaterThanOrEqual(1);
    const callers = modTools.flatMap((tool) => {
      const call = new RegExp(`\\b${tool}\\b`);
      return skillTexts.filter(({ text }) => call.test(text)).map(({ file }) => `${file}: ${tool}`);
    });
    expect(callers).toEqual([]);
  });
});
