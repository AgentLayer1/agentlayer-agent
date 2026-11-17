import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIN_CMUX } from '@/cmux/app';
import { NAME_RE } from '@/shared/agent-name';
import { HOST_FLOORS } from '@/upgrade/hosts';
import {
  LINUX_GUIDE,
  ROOT,
  agentHome,
  app,
  bun,
  changingCalls,
  cleanUp,
  everything,
  frontDoor,
  guide,
  machine,
  pluginFolder,
  plugins,
  stub
} from './harness';

afterAll(cleanUp);
// Each guide run spawns a few dozen stub processes, and the runs share the machine.
setDefaultTimeout(30_000);

const LIB = readFileSync(join(ROOT, 'install', 'lib.sh'), 'utf-8');

const setUpMac = () => {
  const made = machine();
  everything(made);
  const clone = pluginFolder(made, 'clone', { clone: true, packages: true });
  const oppi = agentHome(made, 'Oppi');
  plugins(made, [{ home: oppi, root: clone, source: 'agentlayer-dev' }]);
  return { made, clone, oppi };
};

describe('a set-up Mac', () => {
  test.concurrent('a full run is all ticks, asks nothing, changes nothing, and ends with the start command', async () => {
    const { made } = setUpMac();
    const run = await guide(made, []);

    expect(run.code).toBe(0);
    expect(run.out).not.toContain('○');
    expect(run.out).not.toContain('[Enter] check');
    expect(run.out).toContain('✓ Path · develop the plugin (from Oppi');
    expect(run.out).toContain('✓ Plugin for Oppi · dev install from');
    expect(run.out).toContain('Nothing to do.');
    expect(run.out).toContain('cd ~/Documents/Agents/Oppi && claude');
    expect(changingCalls(run)).toEqual([]);
  });

  test.concurrent('--check says everything is set up and exits 0', async () => {
    const { made } = setUpMac();
    const run = await guide(made, ['--check']);
    expect(run.code).toBe(0);
    expect(run.out).toContain("Everything's set up.");
    expect(changingCalls(run)).toEqual([]);
  });

  test.concurrent('two homes on one clone check its packages once', async () => {
    const { made, clone, oppi } = setUpMac();
    const nova = agentHome(made, 'Nova');
    plugins(made, [
      { home: oppi, root: clone, source: 'agentlayer-dev' },
      { home: nova, root: clone, source: 'agentlayer-dev' }
    ]);
    const run = await guide(made, []);
    expect(run.out.match(/Packages/g)?.length).toBe(1);
    expect(run.out).toContain('✓ Plugin for Nova');
  });

  test.concurrent('a home on the marketplace sets the path, and nothing about a clone comes up', async () => {
    const made = machine();
    everything(made);
    const cache = pluginFolder(made, 'cache', { packages: true });
    plugins(made, [{ home: agentHome(made, 'Oppi'), root: cache }]);
    const run = await guide(made, []);
    expect(run.out).toContain('✓ Path · use the agent (from Oppi');
    expect(run.out).toContain('from the agentlayer marketplace');
    expect(run.out).not.toContain('Your clone');
    expect(run.out).not.toContain('VS Code');
  });

  test.concurrent('a Walle-style home from another plugin is left out of the list', async () => {
    const { made } = setUpMac();
    agentHome(made, 'Other', 'acme-agent');
    expect((await guide(made, [])).out).not.toContain('Other');
  });
});

const bareMac = () => {
  const made = machine();
  ['bun', 'claude'].forEach((name) => rmSync(join(made.bin, name)));
  return made;
};

describe('a bare Mac', () => {
  test.concurrent('without a terminal, the checklist shows every missing step and its link or command', async () => {
    const run = await guide(bareMac(), ['--list']);
    expect(run.code).toBe(1);
    expect(run.out).toContain('https://coteditor.com');
    expect(run.out).toContain('https://brew.sh');
    expect(run.out).toContain('xcode-select --install');
    expect(run.out).toContain('https://bun.sh');
    expect(run.out).toContain('https://code.claude.com/docs/en/setup');
    expect(run.out).toContain('required step(s) left');
    expect(changingCalls(run)).toEqual([]);
  });

  test.concurrent('the guide waits on a required step and quits cleanly, having changed nothing', async () => {
    // 1 picks "use the agent"; s skips CotEditor and Homebrew; the keys run out at the Command Line Tools.
    const run = await guide(bareMac(), [], '1ss');
    expect(run.code).toBe(0);
    expect(run.out).toContain('Command Line Tools');
    expect(run.out).toContain('xcode-select --install');
    expect(run.out).toContain('Stopped here.');
    expect(changingCalls(run)).toEqual([]);
  });

  test.concurrent('a required step can’t be skipped', async () => {
    const run = await guide(bareMac(), [], '1sss');
    expect(run.out).toContain('This one is required');
  });

  test.concurrent('--check counts what is left and exits 1', async () => {
    const run = await guide(bareMac(), ['--check']);
    expect(run.code).toBe(1);
    expect(run.out).toContain('○ Command Line Tools');
  });
});

describe('tools', () => {
  test.concurrent('a Claude Code below the floor shows both versions and the update command', async () => {
    const { made } = setUpMac();
    const run = await guide(made, ['--list'], '', { STUB_CLAUDE: '2.1.300' });
    expect(run.out).toContain('2.1.300 is older than 2.1.314');
    expect(run.out).toContain('claude update');
  });

  test.concurrent('a tool an installer put outside PATH is found, and later commands use its full path', async () => {
    const made = machine();
    everything(made);
    rmSync(join(made.bin, 'bun'));
    bun(made, made.toolDirs);
    mkdirSync(join(made.home, 'Documents', 'Agents', 'Ada'), { recursive: true });
    const cache = pluginFolder(made, 'cache');
    plugins(made, [{ home: join(made.home, 'Documents', 'Agents', 'Ada'), root: cache }]);
    const run = await guide(made, ['--list', '--name', 'Ada', '--marketplace']);
    expect(run.out).toContain('✓ Bun');
    expect(run.out).toContain(`${join(made.toolDirs, 'bun')} install`);
  });

  test.concurrent('t opens the user’s shell, and the step passes as soon as it exits', async () => {
    const { made } = setUpMac();
    rmSync(join(made.bin, 'bun'));
    const spare = join(made.base, 'spare');
    bun(made, spare);
    const run = await guide(made, [], '1t', { STUB_SHELL_DOES: `cp "${join(spare, 'bun')}" "${join(made.bin, 'bun')}"` });
    expect(run.out).toContain('Your shell, here.');
    expect(run.out).toContain('✓ Done · 1.4.4');
    expect(run.code).toBe(0);
    expect(changingCalls(run)).toEqual(['changed bin/bun']);
  });

  test.concurrent('without Homebrew, the tools it brings point at it instead of a brew command', async () => {
    const { made } = setUpMac();
    ['brew', 'pdftoppm'].forEach((name) => rmSync(join(made.bin, name)));
    const run = await guide(made, ['--list']);
    expect(run.out).toContain('This one comes through Homebrew');
    expect(run.out).not.toContain('brew install poppler');
  });
});

describe('cmux', () => {
  test.concurrent('choosing cmux on a Mac without it starts with Ghostty', async () => {
    const { made } = setUpMac();
    ['Ghostty', 'cmux'].forEach((name) => rmSync(join(made.apps, `${name}.app`), { recursive: true }));
    const run = await guide(made, [], '1');
    expect(run.out).toContain('✓ Workspace · cmux');
    expect(run.out).toContain('https://ghostty.org');
    expect(changingCalls(run)).toEqual([]);
  });

  test.concurrent('an old cmux points at its own update', async () => {
    const { made } = setUpMac();
    app(made, 'cmux', '0.60.0');
    const run = await guide(made, ['--list']);
    expect(run.out).toContain('0.60.0 is older than 0.65.2');
    expect(run.out).toContain('Check for Updates');
  });

  test.concurrent('cmux in ~/Applications is asked to move, since the sidebar looks in /Applications', async () => {
    const { made } = setUpMac();
    rmSync(join(made.apps, 'cmux.app'), { recursive: true });
    app(made, 'cmux', '0.65.2', made.userApps);
    expect((await guide(made, ['--list'])).out).toContain('Move cmux.app into');
  });

  test.concurrent('declining cmux makes Obsidian the recommended way to read the brain', async () => {
    const { made } = setUpMac();
    rmSync(join(made.apps, 'Obsidian.app'), { recursive: true });
    const run = await guide(made, ['--list', '--no-cmux']);
    expect(run.out).toContain('✓ Workspace · no cmux');
    expect(run.out).toContain('Obsidian');
    expect(run.out).toContain('recommended');
    expect(run.out).not.toContain('Ghostty settings');
  });

  test.concurrent('missing settings are shown with what to paste and the command, never applied', async () => {
    const { made } = setUpMac();
    writeFileSync(
      made.settings,
      JSON.stringify({ status: 'missing', summary: '3 of 5 set', missing: ['scrollback-limit'], report: ['Missing: scrollback-limit.'], command: 'pbpaste >> ~/.config/ghostty/config', paste: 'scrollback-limit = 25000000\n' })
    );
    const run = await guide(made, ['--list']);
    expect(run.out).toContain('Missing: scrollback-limit.');
    expect(run.out).toContain('pbpaste >> ~/.config/ghostty/config');
    expect(changingCalls(run)).toEqual([]);
  });
});

describe('what the guide reads back', () => {
  test.concurrent('a write by any program, not only a stub, is caught', async () => {
    const { made } = setUpMac();
    const script = join(made.base, 'writes.sh');
    writeFileSync(script, `source ${join(ROOT, 'install', 'lib.sh')}\ntouch "$HOME/sneaky"\n`);
    const run = await guide(made, [], '', {}, script);
    expect(changingCalls(run)).toContain('changed home/sneaky');
  });

  test.concurrent('an AGENT_HOME pinned to another folder stops the guide for an existing home', async () => {
    const { made, oppi } = setUpMac();
    const elsewhere = agentHome(made, 'Elsewhere', 'acme-agent');
    const pinned = await guide(made, [], '', { AGENT_HOME: elsewhere });
    expect(pinned.code).toBe(1);
    expect(pinned.out).toContain('Remove the pin');
    const atHome = await guide(made, [], '', { AGENT_HOME: oppi });
    expect(atHome.code).toBe(0);
  });

  test.concurrent('a plugin that is installed but turned off gets the command to turn it on', async () => {
    const { made, clone, oppi } = setUpMac();
    plugins(made, [{ home: oppi, root: clone, source: 'agentlayer-dev', enabled: false }]);
    const run = await guide(made, ['--list']);
    expect(run.code).toBe(1);
    expect(run.out).toContain('but turned off');
    expect(run.out).toContain('claude plugin enable agentlayer@agentlayer-dev -s local');
  });

  test.concurrent('a browser folder without Playwright’s completion marker is an unfinished install', async () => {
    const { made, clone } = setUpMac();
    rmSync(join(clone, 'node_modules', 'playwright-core', '.local-browsers', 'chromium-1223', 'INSTALLATION_COMPLETE'));
    const run = await guide(made, ['--list']);
    expect(run.code).toBe(1);
    expect(run.out).toContain(`cd ${clone} && bun install`);
  });

  test.concurrent('picking the dev path for a home on the marketplace copy shows how to switch', async () => {
    const made = machine();
    everything(made);
    const cache = pluginFolder(made, 'cache', { packages: true });
    const clone = pluginFolder(made, 'clone', { clone: true });
    const oppi = agentHome(made, 'Oppi');
    plugins(made, [{ home: oppi, root: cache }]);
    const run = await guide(made, ['--list', '--name', 'Oppi', '--dev', clone]);
    expect(run.code).toBe(1);
    expect(run.out).toContain('not your clone');
    expect(run.out).toContain('plugin uninstall agentlayer@agentlayer -s local');
    expect(run.out).toContain('plugin install agentlayer@agentlayer-dev -s local');
  });

  test.concurrent('a settings file that can’t be read is explained, with no empty box to copy', async () => {
    const { made } = setUpMac();
    writeFileSync(made.settings, JSON.stringify({ status: 'broken', summary: "the file can't be read", missing: [], report: ["cmux.json isn't valid JSON."], command: '', paste: '' }));
    const run = await guide(made, ['--list']);
    expect(run.out).toContain("isn't valid JSON");
    expect(run.out).not.toContain('c copies what to paste');
  });

  test.concurrent('a folder with a quote in its name is shown so a pasted command keeps it literal', async () => {
    const made = machine();
    everything(made);
    const odd = join(made.base, "O'Brien agent");
    const run = await guide(made, ['--list', '--home', odd, '--marketplace']);
    expect(run.out).toContain(`mkdir -p '${made.base}/O'\\''Brien agent'`);
  });
});

describe('round 2 fixes', () => {
  test.concurrent('a step the user moved to another unfinished state is redrawn with its new command', async () => {
    const { made } = setUpMac();
    const create = { status: 'create', summary: 'none yet', missing: ['font-size'], report: ['No settings file yet.'], command: 'mkdir -p ~/.config/ghostty && pbpaste > ~/.config/ghostty/config', paste: 'font-size = 14' };
    const missing = { ...create, status: 'missing', report: ['Missing: scrollback-limit.'], command: 'pbpaste >> ~/.config/ghostty/config' };
    writeFileSync(made.settings, JSON.stringify(create));
    const next = join(made.base, 'next.json');
    writeFileSync(next, JSON.stringify(missing));
    const run = await guide(made, [], 't', { STUB_SHELL_DOES: `cp "${next}" "${made.settings}"` });
    const afterRecheck = run.out.slice(run.out.indexOf('Not yet'));
    expect(afterRecheck).toContain('pbpaste >> ~/.config/ghostty/config');
    expect(afterRecheck).not.toContain('pbpaste > ~/.config/ghostty/config');
  });

  test.concurrent('a copy every folder shares is switched off for this folder, not uninstalled', async () => {
    const made = machine();
    everything(made);
    const cache = pluginFolder(made, 'cache', { packages: true });
    const clone = pluginFolder(made, 'clone', { clone: true });
    const oppi = agentHome(made, 'Oppi');
    plugins(made, [{ home: oppi, root: cache, scope: 'user' }]);
    const run = await guide(made, ['--list', '--name', 'Oppi', '--dev', clone]);
    expect(run.out).toContain('plugin disable agentlayer@agentlayer -s local');
    expect(run.out).not.toContain('plugin uninstall');
  });

  test.concurrent('the start line names Claude Code by its full path when the shell won’t find it', async () => {
    const { made } = setUpMac();
    mkdirSync(made.toolDirs, { recursive: true });
    copyFileSync(join(made.bin, 'claude'), join(made.toolDirs, 'claude'));
    rmSync(join(made.bin, 'claude'));
    const run = await guide(made, []);
    expect(run.out).toContain(`cd ~/Documents/Agents/Oppi && ${join(made.toolDirs, 'claude')}`);
  });

  test.concurrent('a folder name outside the name rule isn’t passed to setup, which asks instead', async () => {
    const made = machine();
    everything(made);
    const odd = join(made.base, 'Agent$USER');
    mkdirSync(odd, { recursive: true });
    const cache = pluginFolder(made, 'cache', { packages: true });
    plugins(made, [{ home: odd, root: cache }]);
    const run = await guide(made, ['--home', odd, '--marketplace']);
    expect(run.out).toContain('claude "/agentlayer:init"');
    expect(run.out).not.toContain('name=Agent');
  });

  test.concurrent('a ~ pin at this agent’s own folder is accepted', async () => {
    const { made } = setUpMac();
    const run = await guide(made, [], '', { AGENT_HOME: '~/Documents/Agents/Oppi' });
    expect(run.code).toBe(0);
  });

  test.concurrent('an unfinished headless shell is an unfinished install', async () => {
    const { made, clone } = setUpMac();
    rmSync(join(clone, 'node_modules', 'playwright-core', '.local-browsers', 'chromium_headless_shell-1223', 'INSTALLATION_COMPLETE'));
    const run = await guide(made, ['--list']);
    expect(run.code).toBe(1);
    expect(run.out).toContain(`cd ${clone} && bun install`);
  });

  test.concurrent('a permission change is caught too', async () => {
    const { made } = setUpMac();
    const target = join(made.home, 'mode-target');
    writeFileSync(target, 'x', { mode: 0o600 });
    const script = join(made.base, 'chmods.sh');
    writeFileSync(script, `source ${join(ROOT, 'install', 'lib.sh')}\nchmod 644 "${target}"\n`);
    const run = await guide(made, [], '', {}, script);
    expect(changingCalls(run)).toContain('changed home/mode-target');
  });

  test.concurrent('a write to the temp folder is caught too', async () => {
    const { made } = setUpMac();
    const script = join(made.base, 'writes.sh');
    writeFileSync(script, `source ${join(ROOT, 'install', 'lib.sh')}\ntouch "$TMPDIR/sneaky"\n`);
    const run = await guide(made, [], '', {}, script);
    expect(changingCalls(run)).toContain('changed tmp/sneaky');
  });
});

describe('a new agent', () => {
  test.concurrent('beside an existing home, only the new folder’s steps come up', async () => {
    const { made } = setUpMac();
    const run = await guide(made, ['--list', '--name', 'Ada']);
    expect(run.out).toContain('mkdir -p ~/Documents/Agents/Ada');
    expect(run.out).not.toContain('Plugin for Oppi');
    expect(run.code).toBe(1);
  });

  test.concurrent('stopped after the plugin install, the next step is the packages', async () => {
    const { made, clone } = setUpMac();
    const ada = join(made.home, 'Documents', 'Agents', 'Ada');
    mkdirSync(ada, { recursive: true });
    const cache = pluginFolder(made, 'cache');
    plugins(made, [{ home: ada, root: cache }]);
    const run = await guide(made, ['--list', '--name', 'Ada', '--marketplace']);
    expect(run.out).toContain('✓ Plugin for Ada · from the agentlayer marketplace');
    expect(run.out).toContain(`cd ${cache} && bun install`);
    expect(run.out).not.toContain(clone);
  });

  test.concurrent('a ready folder ends with setup’s command, with the name passed on', async () => {
    const { made } = setUpMac();
    const ada = join(made.home, 'Documents', 'Agents', 'Ada');
    mkdirSync(ada, { recursive: true });
    const cache = pluginFolder(made, 'cache', { packages: true });
    plugins(made, [{ home: ada, root: cache }]);
    const run = await guide(made, ['--name', 'Ada', '--marketplace']);
    expect(run.code).toBe(0);
    expect(run.out).toContain('cd ~/Documents/Agents/Ada && claude "/agentlayer:init name=Ada"');
    expect(changingCalls(run)).toEqual([]);
  });

  test.concurrent('on the dev path, the clone is checked and the plugin comes from its own marketplace', async () => {
    const { made, clone } = setUpMac();
    mkdirSync(join(made.home, 'Documents', 'Agents', 'Ada'), { recursive: true });
    plugins(made, []);
    const run = await guide(made, ['--list', '--name', 'Ada', '--dev', clone]);
    expect(run.out).toContain('✓ Your clone');
    expect(run.out).toContain(`plugin marketplace add ${clone}`);
    expect(run.out).toContain('plugin install agentlayer@agentlayer-dev -s local');
    expect(run.out).toContain('✓ VS Code');
  });

  test.concurrent('a home another plugin made is pointed at its move', async () => {
    const made = machine();
    everything(made);
    const other = join(made.base, 'Other');
    mkdirSync(join(other, '.state'), { recursive: true });
    writeFileSync(join(other, '.state', 'version.json'), JSON.stringify({ plugin: 'acme-agent' }));
    const run = await guide(made, ['--list', '--home', other, '--marketplace']);
    expect(run.code).toBe(1);
    expect(run.out).toContain('move command');
  });

  test.concurrent('a folder inside a git repository is refused', async () => {
    const made = machine();
    everything(made);
    const repo = join(made.base, 'code');
    expect(spawnSync('git', ['init', '-q', repo]).status).toBe(0);
    const run = await guide(made, ['--list', '--home', join(repo, 'agent'), '--marketplace']);
    expect(run.code).toBe(1);
    expect(run.out).toContain('git repository');
  });

  test.concurrent('a name that breaks the rule is refused before anything else', async () => {
    const run = await guide(machine(), ['--name', 'Ada;x']);
    expect(run.code).toBe(2);
    expect(run.out).toContain("won't work as a name");
  });
});

describe('this Mac', () => {
  test.concurrent('a macOS older than 26 stops at the first step', async () => {
    const run = await guide(machine(), ['--list'], '', { STUB_MACOS: '15.5' });
    expect(run.code).toBe(1);
    expect(run.out).toContain('macOS 26 or later');
    expect(run.out).not.toContain('CotEditor');
  });

  test.concurrent('without a UTF-8 locale the marks are plain ASCII', async () => {
    const { made } = setUpMac();
    const run = await guide(made, [], '', { LANG: 'C' });
    expect(run.out).toContain('  ok This Mac');
    expect(run.out).not.toContain('✓');
  });
});

const setUpLinux = () => {
  const made = machine();
  everything(made);
  stub(made, 'uname', '[ "$1" = -sr ] && echo "Linux 6.8.0" || echo Linux');
  stub(made, 'apt-get', 'exit 0');
  stub(made, 'obsidian', 'exit 0');
  const cache = pluginFolder(made, 'cache', { packages: true });
  const oppi = agentHome(made, 'Oppi');
  plugins(made, [{ home: oppi, root: cache }]);
  return { made, cache };
};

const linux = (made: ReturnType<typeof machine>, args: string[], keys = '', env: Record<string, string> = {}) =>
  guide(made, args, keys, env, LINUX_GUIDE);

describe('Linux', () => {
  test.concurrent('a set-up box is all ticks and changes nothing', async () => {
    const { made } = setUpLinux();
    const run = await linux(made, []);
    expect(run.code).toBe(0);
    expect(run.out).toContain('Linux setup guide');
    expect(run.out).toContain('✓ Browser libraries');
    expect(run.out).not.toContain('cmux');
    expect(changingCalls(run)).toEqual([]);
  });

  test.concurrent('a browser missing system libraries gets Playwright’s own install command', async () => {
    const { made, cache } = setUpLinux();
    const shell = join(cache, 'node_modules', 'playwright-core', '.local-browsers', 'chromium_headless_shell-1223', 'chrome-linux');
    mkdirSync(shell, { recursive: true });
    writeFileSync(join(shell, 'chrome-headless-shell'), '');
    spawnSync('chmod', ['+x', join(shell, 'chrome-headless-shell')]);
    stub(made, 'ldd', 'echo "\tlibnss3.so => not found"\necho "\tlibc.so.6 => /lib/libc.so.6"');
    const run = await linux(made, ['--list']);
    expect(run.out).toContain('missing libnss3.so');
    expect(run.out).toContain(`sudo ${join(made.bin, 'bun')} x playwright install-deps chromium`);
    expect(changingCalls(run)).toEqual([]);
  });

  test.concurrent('the shown install commands follow the system’s package manager', async () => {
    const { made } = setUpLinux();
    rmSync(join(made.bin, 'apt-get'));
    stub(made, 'dnf', 'exit 0');
    rmSync(join(made.bin, 'pdftoppm'));
    const run = await linux(made, ['--list']);
    expect(run.out).toContain('sudo dnf install poppler-utils');
  });
});

describe('the front door', () => {
  const darwin = (made: ReturnType<typeof machine>) => stub(made, 'uname', 'echo Darwin');

  test.concurrent('with no terminal it runs the Mac guide as a checklist', async () => {
    const { made } = setUpMac();
    darwin(made);
    const run = await frontDoor(made, []);
    expect(run.code).toBe(0);
    expect(run.out).toContain('Mac setup guide');
    expect(run.out).toContain('Nothing to do.');
    expect(changingCalls(run)).toEqual([]);
  });

  test.concurrent('piped from curl, it fetches the guide from the repository and runs it', async () => {
    const { made } = setUpMac();
    darwin(made);
    stub(
      made,
      'curl',
      'out=""; url=""\nwhile [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; https://*) url=$1 ;; esac; shift; done\ncp "$STUB_SOURCE/$(basename "$url")" "$out"'
    );
    const run = await frontDoor(made, [], { script: readFileSync(join(ROOT, 'install.sh'), 'utf-8'), env: { STUB_SOURCE: join(ROOT, 'install') } });
    expect(run.code).toBe(0);
    expect(run.calls.filter((call) => call.startsWith('curl '))).toHaveLength(2);
    expect(run.out).toContain('Nothing to do.');
    expect(changingCalls(run)).toEqual([]);
  });

  test.concurrent('a download cut short is refused before it runs', async () => {
    const made = machine();
    darwin(made);
    const broken = mkdtempSync(join(tmpdir(), 'broken-'));
    copyFileSync(join(ROOT, 'install', 'macos.sh'), join(broken, 'macos.sh'));
    writeFileSync(join(broken, 'lib.sh'), LIB.slice(0, LIB.length / 2));
    stub(
      made,
      'curl',
      'out=""; url=""\nwhile [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; https://*) url=$1 ;; esac; shift; done\ncp "$STUB_SOURCE/$(basename "$url")" "$out"'
    );
    const run = await frontDoor(made, [], { script: readFileSync(join(ROOT, 'install.sh'), 'utf-8'), env: { STUB_SOURCE: broken } });
    rmSync(broken, { recursive: true, force: true });
    expect(run.code).toBe(1);
    expect(run.out).toContain('incomplete');
    expect(run.out).not.toContain('Mac setup guide');
  });

  test.concurrent('on Linux it runs the Linux guide', async () => {
    const { made } = setUpLinux();
    const run = await frontDoor(made, []);
    expect(run.out).toContain('Linux setup guide');
    expect(run.code).toBe(0);
  });

  test.concurrent('on Windows it points at the PowerShell line', async () => {
    const made = machine();
    stub(made, 'uname', 'echo MINGW64_NT-10.0');
    const run = await frontDoor(made, []);
    expect(run.code).toBe(1);
    expect(run.out).toContain('irm https://agentlayer.one/install.ps1 | iex');
  });

  test.concurrent('under sudo it refuses', async () => {
    const made = machine();
    darwin(made);
    const run = await frontDoor(made, [], { env: { SUDO_USER: 'ada' } });
    expect(run.code).toBe(1);
    expect(run.out).toContain('without sudo');
  });
});

describe('the guide’s copies of the plugin’s rules', () => {
  const value = (name: string): string => LIB.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.replace(/^'|'$/g, '') ?? '';
  const floor = (name: string): string => HOST_FLOORS.find((host) => host.name === name)?.version ?? '';

  test.concurrent('the floors and the name rule match their sources', async () => {
    expect(value('AL_MIN_BUN')).toBe(floor('bun'));
    expect(value('AL_MIN_CLAUDE')).toBe(floor('claude'));
    expect(value('AL_MIN_CMUX')).toBe(MIN_CMUX);
    expect(value('AL_NAME_PATTERN')).toBe(NAME_RE.source);
  });

  test.concurrent('the Windows guide’s copies match them too', async () => {
    const windows = readFileSync(join(ROOT, 'install', 'windows.ps1'), 'utf-8');
    const script = (name: string): string => windows.match(new RegExp(`^\\$Script:${name} = '(.*)'$`, 'm'))?.[1] ?? '';
    expect(script('MinBun')).toBe(floor('bun'));
    expect(script('MinClaude')).toBe(floor('claude'));
    expect(script('NamePattern')).toBe(NAME_RE.source);
    expect(script('MarketplaceRepo')).toBe(value('AL_MARKETPLACE_REPO'));
  });
});

test.concurrent('every guide file ends with the line the front door checks it arrived whole by', async () => {
  ['install/lib.sh', 'install/macos.sh', 'install/linux.sh', 'install/windows.ps1'].forEach((file) =>
    expect(readFileSync(join(ROOT, file), 'utf-8').trimEnd().split('\n').at(-1)).toBe('# agentlayer:end')
  );
});

test.concurrent('every guide and the front door parse under the bash a fresh Mac has', async () => {
  ['install.sh', 'install/lib.sh', 'install/macos.sh', 'install/linux.sh'].forEach((file) =>
    expect(spawnSync('/bin/bash', ['-n', join(ROOT, file)]).status).toBe(0)
  );
});
