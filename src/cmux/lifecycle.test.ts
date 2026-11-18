import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homeEntry } from './entry';
import { parseSidebar, sidebarFile } from './file';
import {
  installSidebar,
  refreshSidebar,
  refreshSidebarQuietly,
  removeSidebar,
  type CmuxHost,
  type SidebarTarget
} from './lifecycle';
import { NOVA, NOVA_HOME, SCOUT, SCOUT_HOME } from './preview/fixture';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const target = (version = '1.1.0', bundle = 'sidebar(() => Text("v1.1"));\n'): SidebarTarget => {
  const dir = mkdtempSync(join(tmpdir(), 'cmux-sidebars-'));
  dirs.push(dir);
  return { dir, own: () => ({ version, bundle }), homeExists: () => true };
};

const fakeCmux = (accepts = true): CmuxHost & { calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    version: '0.65.2',
    run: (args) => {
      calls.push(args);
      return accepts;
    }
  };
};

const nova = homeEntry(NOVA_HOME, NOVA);
const scout = homeEntry(SCOUT_HOME, SCOUT);
const installed = (where: SidebarTarget) => parseSidebar(readFileSync(sidebarFile(where.dir), 'utf8'));

test('install starts the file, has cmux check it under a staging name, then selects it', () => {
  const where = target();
  const cmux = fakeCmux();
  expect(installSidebar(NOVA_HOME, nova, where, cmux).ok).toBe(true);
  expect(cmux.calls).toEqual([
    ['sidebar', 'validate', 'agentlayer-next'],
    ['right-sidebar', 'set', 'custom', 'agentlayer']
  ]);
  expect(installed(where)?.homes).toEqual({ [NOVA_HOME]: nova });
  expect(existsSync(sidebarFile(where.dir, 'agentlayer-next'))).toBe(false);
});

test('a sidebar cmux rejects never replaces the installed one', () => {
  const where = target();
  installSidebar(NOVA_HOME, nova, where, fakeCmux());
  const before = readFileSync(sidebarFile(where.dir), 'utf8');
  const result = installSidebar(SCOUT_HOME, scout, where, fakeCmux(false));
  expect(result).toEqual({ ok: false, message: expect.stringContaining('inside cmux') });
  expect(readFileSync(sidebarFile(where.dir), 'utf8')).toBe(before);
  expect(existsSync(sidebarFile(where.dir, 'agentlayer-next'))).toBe(false);
});

test('install refuses without cmux, or with a cmux older than the floor, and writes nothing', () => {
  const where = target();
  expect(installSidebar(NOVA_HOME, nova, where, { ...fakeCmux(), version: null }).message).toContain('isn’t installed');
  expect(installSidebar(NOVA_HOME, nova, where, { ...fakeCmux(), version: '0.64.9' }).message).toContain('too old');
  expect(existsSync(sidebarFile(where.dir))).toBe(false);
});

test('two homes share one file, and each refresh replaces only its own entry', () => {
  const where = target();
  installSidebar(NOVA_HOME, nova, where, fakeCmux());
  installSidebar(SCOUT_HOME, scout, where, fakeCmux());
  const renamed = { ...nova, name: 'Nova II' };
  expect(refreshSidebar(NOVA_HOME, renamed, where)).toBe('written');
  expect(installed(where)?.homes).toEqual({ [NOVA_HOME]: renamed, [SCOUT_HOME]: scout });
});

test('a refresh with nothing new leaves the file alone', () => {
  const where = target();
  installSidebar(NOVA_HOME, nova, where, fakeCmux());
  const before = readFileSync(sidebarFile(where.dir), 'utf8');
  expect(refreshSidebar(NOVA_HOME, nova, where)).toBe('unchanged');
  expect(readFileSync(sidebarFile(where.dir), 'utf8')).toBe(before);
});

test('refresh writes nothing on a Mac without the sidebar, or for a home that never joined', () => {
  const where = target();
  expect(refreshSidebar(NOVA_HOME, nova, where)).toBe('not-installed');
  expect(existsSync(sidebarFile(where.dir))).toBe(false);
  installSidebar(NOVA_HOME, nova, where, fakeCmux());
  const before = readFileSync(sidebarFile(where.dir), 'utf8');
  expect(refreshSidebar(SCOUT_HOME, scout, where)).toBe('not-joined');
  expect(readFileSync(sidebarFile(where.dir), 'utf8')).toBe(before);
});

test('an update lost to another home’s write at the same moment comes back at the next refresh', () => {
  const where = target();
  installSidebar(NOVA_HOME, nova, where, fakeCmux());
  installSidebar(SCOUT_HOME, scout, where, fakeCmux());
  const snapshotBeforeScoutsUpdate = readFileSync(sidebarFile(where.dir), 'utf8');
  refreshSidebar(SCOUT_HOME, { ...scout, roadmap: 'file:///roadmap.html' }, where);
  writeFileSync(sidebarFile(where.dir), snapshotBeforeScoutsUpdate);
  expect(installed(where)?.homes[SCOUT_HOME]?.roadmap).toBeNull();
  expect(refreshSidebar(SCOUT_HOME, { ...scout, roadmap: 'file:///roadmap.html' }, where)).toBe('written');
  expect(installed(where)?.homes[SCOUT_HOME]?.roadmap).toBe('file:///roadmap.html');
});

test('a refresh from an older plugin keeps the newer code', () => {
  const where = target('1.2.0', 'newer\n');
  installSidebar(NOVA_HOME, nova, where, fakeCmux());
  const older: SidebarTarget = { ...where, own: () => ({ version: '1.1.0', bundle: 'older\n' }) };
  refreshSidebar(NOVA_HOME, { ...nova, emoji: '🦊' }, older);
  expect(installed(where)).toMatchObject({ version: '1.2.0', bundle: 'newer\n' });
  expect(installed(where)?.homes[NOVA_HOME]?.emoji).toBe('🦊');
});

test('a file the writer didn’t produce is left to the next install, which rebuilds it', () => {
  const where = target();
  writeFileSync(sidebarFile(where.dir), 'sidebar(() => Text("hand-made"));\n');
  expect(refreshSidebar(NOVA_HOME, nova, where)).toBe('not-joined');
  expect(readFileSync(sidebarFile(where.dir), 'utf8')).toBe('sidebar(() => Text("hand-made"));\n');
  installSidebar(NOVA_HOME, nova, where, fakeCmux());
  expect(installed(where)?.homes).toEqual({ [NOVA_HOME]: nova });
});

test('remove takes one home out, and the last home out deletes the file', () => {
  const where = target();
  installSidebar(NOVA_HOME, nova, where, fakeCmux());
  installSidebar(SCOUT_HOME, scout, where, fakeCmux());
  expect(removeSidebar(NOVA_HOME, where)).toBe('removed');
  expect(installed(where)?.homes).toEqual({ [SCOUT_HOME]: scout });
  expect(removeSidebar(NOVA_HOME, where)).toBe('not-joined');
  expect(removeSidebar(SCOUT_HOME, where)).toBe('removed-file');
  expect(existsSync(sidebarFile(where.dir))).toBe(false);
});

test('the dashboard’s refresh never throws, even when the write fails', () => {
  const where = target();
  installSidebar(NOVA_HOME, nova, where, fakeCmux());
  const broken: SidebarTarget = {
    ...where,
    own: () => {
      throw new Error('dist missing');
    }
  };
  expect(() =>
    refreshSidebarQuietly(NOVA_HOME, { ...NOVA, agent: { ...NOVA.agent, name: 'Changed' } }, broken)
  ).not.toThrow();
});
