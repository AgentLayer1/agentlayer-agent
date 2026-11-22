import { describe, expect, test } from 'bun:test';
import { HOME_MARKER_FILES, PLUGIN_SOURCE_ROOT, RUNTIME_DIR, agentSlug, pluginName } from '@/shared/naming';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DATA_DIR, HOME_MARKERS } from '../../mods/manuals/repo';
import { LIVE_STATUSES } from '../../mods/tasks/statuses';
import { isValidTransition } from '@/tasks/schema';
import type { TaskStatus } from '@/tasks/types';
import { MOD_FEATURES } from '../../mods/shared/catalog';
import { DEFAULT_AGENT_NAME as MODS_DEFAULT_NAME } from '../../mods/shared/agent';
import { DEFAULT_AGENT_NAME } from '@/shared/persona';
import { TASK_REF } from '@/tasks/prefix';
import { MAY_HOLD_ID, linkTaskIds } from '../../mods/tasks/link';
import { showsInRecent } from '../../mods/sidebar/paths';
import { MESSAGE_CHOICES as MOD_CHOICES } from '../../mods/heartbeat/beat';
import { MESSAGE_CHOICES } from '@/messages/choices';
import { readRecentFiles } from '@/cmux/recent';

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

  test("the sidebar refresh asks for a refresh on exactly the files the sidebar's Recent finds in a home's default layout", () => {
    const paths = [
      'USER.md',
      'roadmap.html',
      'dashboard.html',
      'notes.md',
      'projects/TASKS.md',
      'projects/acme/README.md',
      'projects/acme/tasks/ac-001.md',
      'projects/acme/tasks/archive/ac-000.md',
      'projects/acme/data.json',
      'projects/acme/node_modules/pkg/README.md',
      'projects/.obsidian/x.md',
      'reports/index.md',
      'reports/pinned.md',
      'reports/plans/spec.md',
      'reports/captures/shot.png',
      'reports/loose.md',
      'knowledge/index.md',
      'knowledge/user/profile.md',
      'knowledge/user/assets/avatar.jpg',
      'knowledge/concepts/idea.md',
      'knowledge/memory/index.md',
      'knowledge/memory/2026-03-10.md',
      'knowledge/memory/archive/decisions-2026-02.md',
      'knowledge/memory/notes.md',
      'knowledge/raw/sessions/2026-03-10.md',
      'extensions/skills/briefing.md',
      'extensions/skills/helper.ts',
      'scripts/run.md',
      '.state/work.json',
      '.claude/rules/xcode.md'
    ];
    const home = mkdtempSync(join(tmpdir(), 'recent-contract-'));
    try {
      paths.forEach((path) => {
        mkdirSync(dirname(join(home, path)), { recursive: true });
        writeFileSync(join(home, path), '');
      });
      const folders = {
        home,
        projects: join(home, 'projects'),
        reports: join(home, 'reports'),
        knowledge: join(home, 'knowledge')
      };
      const found = readRecentFiles(folders)
        .map((item) => item.path)
        .toSorted();
      expect(found.length).toBeGreaterThan(8);
      expect(paths.filter(showsInRecent).toSorted()).toEqual(found);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('the dashboard catalog lists every feature the module registers', () => {
    const register = readFileSync(resolve(PLUGIN_SOURCE_ROOT, 'mods/hooks/register.ts'), 'utf-8');
    const registered = [...register.matchAll(/from '\.\.\/([\w-]+)\//g)].map((match) => match[1]);
    expect(registered.length).toBeGreaterThan(0);
    expect(MOD_FEATURES.map((feature) => feature.id).sort()).toEqual(registered.sort());
  });
});

test("/message takes exactly the choices messages decide does, so the sidebar's buttons never type one the CLI refuses", () => {
  expect([...MOD_CHOICES]).toEqual([...MESSAGE_CHOICES]);
});
