import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKS } from '@/packs/registry';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';

const CONFIGURE = readFileSync(join(PLUGIN_SOURCE_ROOT, 'skills', 'configure-skills', 'SKILL.md'), 'utf-8');
const DESCRIPTION = /^description: (.*)$/m.exec(CONFIGURE)?.[1] ?? '';
const packs = Object.values(PACKS);
const labels = packs.map((pack) => pack.label);

const walkHeading = (walk: string): RegExp =>
  walk.startsWith('A.')
    ? new RegExp(`^### ${walk.replace('.', '\\.')} — `, 'm')
    : new RegExp(`^## Section ${walk} — `, 'm');

const sources = (dir: string): string[] =>
  readdirSync(join(PLUGIN_SOURCE_ROOT, dir), { recursive: true, encoding: 'utf-8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => readFileSync(join(PLUGIN_SOURCE_ROOT, dir, file), 'utf-8'));

describe('the pack registry and configure-skills', () => {
  test("every pack's walk is a section of configure-skills", () => {
    expect(packs.filter((pack) => !walkHeading(pack.walk).test(CONFIGURE)).map((pack) => pack.walk)).toEqual([]);
  });

  test('every pack configure can take out has its removal entry', () => {
    expect(
      packs
        .filter((pack) => pack.removable && !CONFIGURE.includes(`**${pack.label} deconfigure:**`))
        .map((pack) => pack.label)
    ).toEqual([]);
  });

  test("configure-skills' description names every pack, so asking for one by name finds it", () => {
    expect(labels.filter((label) => !DESCRIPTION.includes(label))).toEqual([]);
  });

  test('every "configure-skills → <pack>" pointer in the code names a real pack', () => {
    const named = [...sources('src'), ...sources('mods')].flatMap((text) =>
      [...text.matchAll(/configure-skills → (?:the )?([A-Z][A-Za-z]+(?: Store)?)/g)].map((match) => match[1] ?? '')
    );
    expect(named.length).toBeGreaterThan(3);
    expect(named.filter((name) => !labels.includes(name))).toEqual([]);
  });
});
