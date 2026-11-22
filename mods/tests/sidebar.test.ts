import { describe, expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

import { HOME, USER_HOME, fakeHost, machine } from './fake-host';
import type { FakeHost } from './fake-host';

const SIDEBAR = `${USER_HOME}/.config/cmux/sidebars/agentlayer.js`;
const REFRESH = ['cmux', 'sidebar', 'refresh', `--home=${HOME}`];

const refreshes = (host: FakeHost) => host.argv.filter((argv) => argv.slice(2).join(' ') === REFRESH.join(' '));

const write = ($: Engine, file_path: string) => $.tool.call({ tool: 'Write', file_path, content: 'x' });

const withSidebar = () => machine({ files: { ...machine().files, [SIDEBAR]: '/* agentlayer sidebar */' } });

describe('sidebar refresh', () => {
  test('a file written in the home refreshes the installed sidebar for that home, from the home', async ($, on) => {
    const host = fakeHost(on, withSidebar());
    await write($, `${HOME}/projects/acme/README.md`);
    await host.clock.settle();
    expect(refreshes(host)).toHaveLength(1);
    expect(host.cwd.at(-1)).toBe(HOME);
  });

  test('an edit refreshes it too', async ($, on) => {
    const host = fakeHost(on, withSidebar());
    await $.tool.call({ tool: 'Edit', file_path: `${HOME}/USER.md`, old_string: 'a', new_string: 'b' });
    await host.clock.settle();
    expect(refreshes(host)).toHaveLength(1);
  });

  test('edits in a burst share refreshes instead of running one each', async ($, on) => {
    const host = fakeHost(on, withSidebar());
    await Promise.all(['a', 'b', 'c', 'd'].map((name) => write($, `${HOME}/reports/plans/${name}.md`)));
    await host.clock.settle();
    expect(refreshes(host).length).toBeGreaterThan(0);
    expect(refreshes(host).length).toBeLessThanOrEqual(2);
  });

  test('state, settings, raw inputs and files outside the home cost no process or filesystem call', async ($, on) => {
    const host = fakeHost(on, withSidebar());
    await write($, `${HOME}/.state/work.json`);
    await write($, `${HOME}/.claude/settings.local.json`);
    await write($, `${HOME}/knowledge/raw/sessions/2026-03-10.md`);
    await write($, '/elsewhere/app/index.ts');
    await host.clock.settle();
    expect(host.argv).toEqual([]);
    expect(host.fsCalls).toEqual([]);
  });

  test('a generated file in the home refreshes nothing', async ($, on) => {
    const host = fakeHost(on, withSidebar());
    await write($, `${HOME}/projects/TASKS.md`);
    await write($, `${HOME}/reports/index.md`);
    await host.clock.settle();
    expect(refreshes(host)).toHaveLength(0);
    expect(host.fsCalls, 'never looks for the sidebar').not.toContain(SIDEBAR);
  });

  test('without the sidebar installed, a write in the home refreshes nothing', async ($, on) => {
    const host = fakeHost(on, machine());
    await write($, `${HOME}/projects/acme/README.md`);
    await host.clock.settle();
    expect(refreshes(host)).toHaveLength(0);
  });
});
