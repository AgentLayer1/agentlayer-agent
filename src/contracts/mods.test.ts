import { describe, expect, test } from 'bun:test';
import { HOME_MARKER_FILES, PLUGIN_SOURCE_ROOT, RUNTIME_DIR, agentSlug, pluginName } from '@/shared/naming';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, HOME_MARKERS } from '../../mods/manuals/repo';
import { LIVE_STATUSES } from '../../mods/tasks/statuses';
import { isValidTransition } from '@/tasks/schema';
import type { TaskStatus } from '@/tasks/types';
import { MOD_FEATURES } from '../../mods/shared/catalog';
import { DEFAULT_AGENT_NAME as MODS_DEFAULT_NAME } from '../../mods/shared/agent';
import { DEFAULT_AGENT_NAME } from '@/shared/persona';
import { TASK_REF } from '@/tasks/prefix';
import { MAY_HOLD_ID, linkTaskIds } from '../../mods/tasks/link';

describe('mods', () => {
  test("the task linker's id shape is the plugin's, collision prefixes and four-digit ids included", () => {
    const ids = ['ac-001', 'hs2-001', 'ab-1234'];
    expect(ids.every((id) => new RegExp(`^${TASK_REF}$`).test(id))).toBe(true);
    expect(ids.every((id) => MAY_HOLD_ID.test(id))).toBe(true);
    const linked = linkTaskIds(ids.join(' and '), new Map(ids.map((id) => [id, `https://tasks.example/${id}`])));
    expect(ids.every((id) => linked.includes(`https://tasks.example/${id}`))).toBe(true);
  });

  test("the instruction loader marks an agent home with the runtime's own marker files", () => {
    expect(HOME_MARKERS).toEqual([...HOME_MARKER_FILES]);
  });

  test("the setup prompt looks for the runtime's own data dir", () => {
    expect(DATA_DIR).toBe(RUNTIME_DIR);
  });

  test('the setup prompt names a new agent the way the server does', () => {
    expect(MODS_DEFAULT_NAME).toBe(DEFAULT_AGENT_NAME);
  });

  test("the mods' tests spell the plugin and its server the way the manifest does", () => {
    const fakeHost = readFileSync(resolve(PLUGIN_SOURCE_ROOT, 'mods/tests/fake-host.ts'), 'utf-8');
    expect(fakeHost).toContain(`PLUGIN = '${pluginName()}'`);
    expect(fakeHost).toContain(`AGENT = '${agentSlug()}'`);
  });

  test("/task's done and cancel act on exactly the statuses the task schema can close or cancel", () => {
    const statuses: readonly TaskStatus[] = ['open', 'active', 'blocked', 'done', 'cancelled'];
    const closable = statuses.filter(
      (status) =>
        isValidTransition(status, 'cancelled') &&
        (isValidTransition(status, 'done') || isValidTransition(status, 'active'))
    );
    expect<readonly string[]>(closable).toEqual(LIVE_STATUSES);
  });

  test("no mod command shares a name with one of the plugin's skills, which the host refuses", () => {
    const skills = new Set(readdirSync(resolve(PLUGIN_SOURCE_ROOT, 'skills')));
    const commands = MOD_FEATURES.flatMap((feature) => feature.commands.map((command) => command.name));
    expect(commands.length).toBeGreaterThan(5);
    expect(commands.filter((name) => skills.has(name))).toEqual([]);
  });

  test('the dashboard catalog lists every feature the module registers', () => {
    const register = readFileSync(resolve(PLUGIN_SOURCE_ROOT, 'mods/hooks/register.ts'), 'utf-8');
    const registered = [...register.matchAll(/from '\.\.\/([\w-]+)\//g)].map((match) => match[1]);
    expect(registered.length).toBeGreaterThan(0);
    expect(MOD_FEATURES.map((feature) => feature.id).sort()).toEqual(registered.sort());
  });
});
