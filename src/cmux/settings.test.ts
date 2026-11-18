import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSettings, templatePath } from './settings';

const GHOSTTY_TEMPLATE = readFileSync(templatePath('ghostty'), 'utf-8');
const CMUX_TEMPLATE = readFileSync(templatePath('cmux'), 'utf-8');

let home = '';
const apps = (): string => join(home, 'Applications');

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'settings-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const write = (parts: string[], text: string): void => {
  const path = join(home, ...parts);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

const GHOSTTY = ['.config', 'ghostty', 'config'];
const GHOSTTY_APP_SUPPORT = ['Library', 'Application Support', 'com.mitchellh.ghostty', 'config'];
const CMUX = ['.config', 'cmux', 'cmux.json'];

test('with no Ghostty file, the whole template is offered to create it', () => {
  const report = checkSettings('ghostty', home);
  expect(report.missing).toContain('scrollback-limit');
  expect(report.command).toBe('mkdir -p ~/.config/ghostty && pbpaste > ~/.config/ghostty/config');
  expect(report.paste).toBe(GHOSTTY_TEMPLATE);
});

test('a Ghostty file missing settings gets only the missing lines, appended', () => {
  write(GHOSTTY, 'font-size = 14\nkeybind = cmd+t=new_tab\n');
  const report = checkSettings('ghostty', home);
  expect(report.missing).not.toContain('font-size');
  expect(report.missing).not.toContain('keybind cmd+t');
  expect(report.missing).toContain('keybind cmd+d');
  expect(report.missing).toContain('scrollback-limit');
  expect(report.command).toBe('pbpaste >> ~/.config/ghostty/config');
  expect(report.paste).toContain('scrollback-limit = 25000000');
  expect(report.paste).not.toContain('font-size = 14');
});

test('a Ghostty file holding the template is complete, comments and all', () => {
  write(GHOSTTY, GHOSTTY_TEMPLATE);
  const report = checkSettings('ghostty', home);
  expect(report.missing).toEqual([]);
  expect(report.different).toEqual([]);
  expect(report.command).toBe('');
});

test('a Ghostty value the user changed is reported, never counted missing', () => {
  write(GHOSTTY, GHOSTTY_TEMPLATE.replace('font-size = 14', 'font-size = 16').replace('keybind = cmd+d=new_split:right', 'keybind = cmd+d=new_split:down'));
  const report = checkSettings('ghostty', home);
  expect(report.missing).toEqual([]);
  expect(report.different).toEqual([
    { key: 'font-size', yours: '16', ours: '14' },
    { key: 'keybind cmd+d', yours: 'cmd+d=new_split:down', ours: 'cmd+d=new_split:right' }
  ]);
});

test("Ghostty's Application Support file is read last, so its value wins", () => {
  write(GHOSTTY, GHOSTTY_TEMPLATE);
  write(GHOSTTY_APP_SUPPORT, 'font-size = 18\n');
  expect(checkSettings('ghostty', home).different).toEqual([{ key: 'font-size', yours: '18', ours: '14' }]);
});

test('with no cmux file, the whole template is offered to create it', () => {
  const report = checkSettings('cmux', home, apps());
  expect(report.command).toBe('mkdir -p ~/.config/cmux && pbpaste > ~/.config/cmux/cmux.json');
  expect(report.paste).toBe(CMUX_TEMPLATE);
});

test('with only Ghostty\'s Application Support file, the shown command quotes its path', () => {
  write(GHOSTTY_APP_SUPPORT, '# comments only\n');
  expect(checkSettings('ghostty', home).command).toBe(`pbpaste >> '${join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')}'`);
});

test('a cmux file missing the Manager button gets a fragment to merge, after a backup', () => {
  const partial = JSON.parse(CMUX_TEMPLATE);
  delete partial.actions.manager;
  partial.ui.surfaceTabBar.buttons = ['claude', 'cmux.newTerminal'];
  write(CMUX, JSON.stringify(partial));
  const report = checkSettings('cmux', home, apps());
  expect(report.missing).toEqual(['manager button', 'cmux.splitRight in the tab bar', 'cmux.splitDown in the tab bar', 'manager in the tab bar']);
  expect(report.command).toStartWith('cp ~/.config/cmux/cmux.json ~/.config/cmux/cmux.json.bak-');
  expect(report.command).not.toContain('open -a CotEditor');
  expect(report.report.join(' ')).toContain('such as CotEditor');
  mkdirSync(join(apps(), 'CotEditor.app'), { recursive: true });
  expect(checkSettings('cmux', home, apps()).command).toEndWith('&& open -a CotEditor ~/.config/cmux/cmux.json');
  const fragment = JSON.parse(report.paste);
  expect(Object.keys(fragment.actions)).toEqual(['manager']);
  expect(fragment.ui.surfaceTabBar.buttons).toEqual(['claude', 'cmux.newTerminal', 'cmux.splitRight', 'cmux.splitDown', 'manager']);
  expect(fragment.shortcuts).toBeUndefined();
});

test("a cmux file with the user's own launcher and extra buttons is complete, its differences listed", () => {
  const custom = JSON.parse(CMUX_TEMPLATE);
  custom.actions.claude.command = 'agent';
  custom.actions.codex = { type: 'command', command: 'codex', target: 'newTabInCurrentPane', title: 'Codex' };
  custom.ui.surfaceTabBar.buttons = ['claude', 'codex', 'cmux.newTerminal', 'cmux.splitRight', 'cmux.splitDown', 'manager'];
  custom.shortcuts.bindings.closeTab = null;
  write(CMUX, JSON.stringify(custom));
  const report = checkSettings('cmux', home, apps());
  expect(report.missing).toEqual([]);
  expect(report.different).toEqual([{ key: 'claude button', yours: 'agent', ours: 'claude' }]);
  expect(report.paste).toBe('');
});

test('a shortcut set to null counts as missing', () => {
  const nulled = JSON.parse(CMUX_TEMPLATE);
  nulled.shortcuts.bindings.renameTab = null;
  write(CMUX, JSON.stringify(nulled));
  expect(checkSettings('cmux', home, apps()).missing).toEqual(['renameTab shortcut']);
});

test('a cmux file that isn\'t valid JSON is reported as broken, not as missing everything', () => {
  write(CMUX, '{ "actions": ');
  const report = checkSettings('cmux', home, apps());
  expect(report.status).toBe('broken');
  expect(report.missing).toEqual([]);
  expect(report.report.join(' ')).toContain("isn't valid JSON");
  expect(report.paste).toBe('');
  expect(report.command).toBe('');
});

test('CotEditor in ~/Applications counts too', () => {
  const partial = JSON.parse(CMUX_TEMPLATE);
  delete partial.actions.manager;
  write(CMUX, JSON.stringify(partial));
  mkdirSync(join(home, 'Applications', 'CotEditor.app'), { recursive: true });
  expect(checkSettings('cmux', home, join(home, 'none')).command).toContain('open -a CotEditor');
});

test('every section of the cmux template is one the checker compares', () => {
  expect(Object.keys(JSON.parse(CMUX_TEMPLATE)).sort()).toEqual(['$schema', 'actions', 'computerUse', 'schemaVersion', 'shortcuts', 'ui']);
  expect(Object.keys(JSON.parse(CMUX_TEMPLATE).ui)).toEqual(['surfaceTabBar']);
});

test('with the agent launcher, the Claude Code button is recommended to run agent', () => {
  const fresh = checkSettings('cmux', home, apps(), 'agent');
  expect(JSON.parse(fresh.paste).actions.claude.command).toBe('agent');
  const custom = JSON.parse(CMUX_TEMPLATE);
  custom.actions.claude.command = 'agent';
  write(CMUX, JSON.stringify(custom));
  expect(checkSettings('cmux', home, apps(), 'agent').different).toEqual([]);
  expect(checkSettings('cmux', home, apps(), 'claude').different).toEqual([{ key: 'claude button', yours: 'agent', ours: 'claude' }]);
});

