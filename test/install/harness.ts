import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';

export const ROOT = PLUGIN_SOURCE_ROOT;
const FRONT_DOOR = join(ROOT, 'install.sh');
const MAC_GUIDE = join(ROOT, 'install', 'macos.sh');
export const LINUX_GUIDE = join(ROOT, 'install', 'linux.sh');

// Nothing real is reachable from a pretend machine: PATH holds only its logging stubs and the system's own /usr/bin and /bin.
interface Machine {
  base: string;
  home: string;
  bin: string;
  apps: string;
  userApps: string;
  toolDirs: string;
  tmp: string;
  log: string;
  plugins: string;
  settings: string;
}

const made: string[] = [];

export const cleanUp = (): void => {
  made.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
};

export const stub = (machine: Machine, name: string, body: string, dir = machine.bin): void => {
  mkdirSync(dir, { recursive: true });
  // One log line per call, even when an argument (a bun -e script) spans several.
  writeFileSync(join(dir, name), `#!/bin/bash\nall="$*"\nprintf '%s %s\\n' "${name}" "\${all//$'\\n'/ }" >> "$STUB_LOG"\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
};

const tool = (machine: Machine, name: string, version: string, dir = machine.bin): void =>
  stub(machine, name, `[ "$1" = --version ] && echo "${name} ${version}"\nexit 0`, dir);

export const app = (machine: Machine, name: string, version: string, dir = machine.apps): void => {
  const contents = join(dir, `${name}.app`, 'Contents');
  mkdirSync(contents, { recursive: true });
  writeFileSync(
    join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`
  );
};

export const agentHome = (machine: Machine, name: string, plugin = 'agentlayer'): string => {
  const home = join(machine.home, 'Documents', 'Agents', name);
  mkdirSync(join(home, '.state'), { recursive: true });
  writeFileSync(join(home, '.state', 'version.json'), JSON.stringify({ plugin }, null, 2));
  writeFileSync(join(home, 'SOUL.md'), '# Soul\n');
  return home;
};

export const pluginFolder = (machine: Machine, name: string, options: { clone?: boolean; packages?: boolean } = {}): string => {
  const root = join(machine.base, name);
  mkdirSync(join(root, 'src'), { recursive: true });
  if (options.clone) {
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'agentlayer' }, null, 2));
  }
  if (options.packages) {
    ['chromium-1223', 'chromium_headless_shell-1223'].forEach((name) => {
      const browser = join(root, 'node_modules', 'playwright-core', '.local-browsers', name);
      mkdirSync(browser, { recursive: true });
      writeFileSync(join(browser, 'INSTALLATION_COMPLETE'), '');
    });
  }
  return root;
};

export const plugins = (
  machine: Machine,
  entries: { home: string; root: string; source?: string; enabled?: boolean; scope?: string }[]
): void =>
  writeFileSync(
    machine.plugins,
    JSON.stringify(
      entries.map(({ home, root, source = 'agentlayer', enabled = true, scope = 'local' }) => ({
        id: `agentlayer@${source}`,
        scope,
        ...(scope === 'user' ? {} : { projectPath: home }),
        installPath: root,
        enabled
      }))
    )
  );

export const everything = (machine: Machine): void => {
  ['brew', 'uv', 'gh', 'jq'].forEach((name) => tool(machine, name, '1.0.0'));
  stub(machine, 'pdftoppm', 'echo "pdftoppm version 26.09.0" >&2\nexit 0');
  stub(machine, 'xcode-select', '[ "$1" = -p ] && echo /Library/Developer/CommandLineTools\nexit 0');
  ['CotEditor', 'Ghostty', 'Obsidian', 'Visual Studio Code'].forEach((name) => app(machine, name, '1.0'));
  app(machine, 'cmux', '0.65.2');
};

// bun -e parses JSON for the guide, so it runs the real bun; the plugin's CLI answers from a file.
export const bun = (machine: Machine, dir = machine.bin): void =>
  stub(
    machine,
    'bun',
    `case "$1" in
  --version) echo "\${STUB_BUN:-1.4.4}" ;;
  -e) shift; exec "$REAL_BUN" -e "$@" ;;
  */src/cli.ts) cat "$STUB_SETTINGS" ;;
esac
exit 0`,
    dir
  );

export const machine = (): Machine => {
  const base = mkdtempSync(join(tmpdir(), 'guide-'));
  made.push(base);
  const made_ = {
    base,
    home: join(base, 'home'),
    bin: join(base, 'bin'),
    apps: join(base, 'Applications'),
    userApps: join(base, 'home', 'Applications'),
    toolDirs: join(base, 'tool-dirs'),
    tmp: join(base, 'tmp'),
    log: join(base, 'calls.log'),
    plugins: join(base, 'plugins.json'),
    settings: join(base, 'settings.json')
  };
  [made_.home, made_.bin, made_.apps, made_.tmp].forEach((dir) => mkdirSync(dir, { recursive: true }));
  writeFileSync(made_.log, '');
  writeFileSync(made_.plugins, '[]');
  writeFileSync(made_.settings, JSON.stringify({ status: 'ok', summary: 'all set', missing: [], report: [], command: '', paste: '' }));
  stub(made_, 'sw_vers', 'echo "${STUB_MACOS:-27.2}"');
  stub(made_, 'xcode-select', 'exit 2');
  stub(
    made_,
    'claude',
    `case "$1" in
  --version) echo "\${STUB_CLAUDE:-2.1.326} (Claude Code)" ;;
  plugin) [ "$2" = list ] && cat "$STUB_PLUGINS" ;;
esac
exit 0`
  );
  bun(made_);
  ['open', 'pbcopy'].forEach((name) => stub(made_, name, 'exit 0'));
  stub(made_, 'shell', '[ -n "$STUB_SHELL_DOES" ] && sh -c "$STUB_SHELL_DOES"\nexit 0');
  return made_;
};

interface Run {
  code: number | null;
  out: string;
  calls: string[];
  changes: string[];
}

// Every file and folder in the fixture with its permissions, size and modified time, so a run that changes it shows up,
// whatever binary it used. The stubs' own call log is the one file allowed to change. Writes outside the fixture
// (an absolute path elsewhere) aren't seen.
const snapshot = (machine: Machine): Map<string, string> =>
  new Map(
    readdirSync(machine.base, { recursive: true, encoding: 'utf-8' })
      .filter((path) => path !== 'calls.log')
      .map((path) => {
        const stat = statSync(join(machine.base, path));
        return [path, stat.isDirectory() ? `dir:${stat.mode}` : `${stat.mode}:${stat.size}:${stat.mtimeMs}`];
      })
  );

const changed = (before: Map<string, string>, after: Map<string, string>): string[] =>
  [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path)).sort();

const environment = (machine: Machine, extra: Record<string, string>): Record<string, string> => ({
  PATH: `${machine.bin}:/usr/bin:/bin`,
  HOME: machine.home,
  // Inside the fixture, so the snapshot sees temp files too.
  TMPDIR: machine.tmp,
  LANG: 'en_US.UTF-8',
  NO_COLOR: '1',
  TERM: 'dumb',
  SHELL: join(machine.bin, 'shell'),
  AL_TOOL_DIRS: machine.toolDirs,
  AL_APP_DIRS: `${machine.apps}:${machine.userApps}`,
  STUB_LOG: machine.log,
  STUB_PLUGINS: machine.plugins,
  STUB_SETTINGS: machine.settings,
  REAL_BUN: process.execPath,
  ...extra
});

const calls = (machine: Machine): string[] => readFileSync(machine.log, 'utf-8').split('\n').filter(Boolean);

const collect = (child: ReturnType<typeof spawn>, machine: Machine, input: string, before: Map<string, string>): Promise<Run> =>
  new Promise((done) => {
    let out = '';
    child.stdout?.on('data', (chunk) => (out += chunk));
    child.stderr?.on('data', (chunk) => (out += chunk));
    child.stdin?.end(input);
    child.on('close', (code) => done({ code, out, calls: calls(machine), changes: changed(before, snapshot(machine)) }));
  });

export const guide = (machine: Machine, args: string[], keys = '', env: Record<string, string> = {}, script = MAC_GUIDE): Promise<Run> => {
  const before = snapshot(machine);
  return collect(spawn('/bin/bash', [script, ...args], { env: environment(machine, env), stdio: ['pipe', 'pipe', 'pipe'] }), machine, keys, before);
};

// Detached, so the front door never finds the terminal running the tests and waits on it.
export const frontDoor = (
  machine: Machine,
  args: string[],
  options: { script?: string; env?: Record<string, string> } = {}
): Promise<Run> => {
  const piped = options.script !== undefined;
  const before = snapshot(machine);
  const child = spawn('/bin/bash', piped ? ['-s', '--', ...args] : [FRONT_DOOR, ...args], {
    env: environment(machine, options.env ?? {}),
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  return collect(child, machine, options.script ?? '', before);
};

// Every call a guide may make. Anything else that reaches a stub is a change, and fails the test.
const READ_ONLY = [
  /^\S+ --version$/,
  /^sw_vers -productVersion$/,
  /^xcode-select -p$/,
  /^pdftoppm -v$/,
  /^claude plugin list --json$/,
  /^bun -e /,
  /^bun \S+\/src\/cli\.ts cmux settings --file=(ghostty|cmux) --launcher=(claude|agent) --json$/,
  /^shell -l$/,
  /^pbcopy $/,
  /^open https?:\/\/\S+$/,
  /^uname -s$/,
  /^uname -sr$/,
  /^ldd \S+$/,
  /^curl .* https:\/\/raw\.githubusercontent\.com\/AgentLayer1\/agentlayer-agent\/main\/install\/\S+ -o \S+$/
];

// Calls outside the allowlist, and any file a run changed.
export const changingCalls = (run: Run): string[] => [
  ...run.calls.filter((call) => !READ_ONLY.some((pattern) => pattern.test(call.split('\n')[0] ?? ''))),
  ...run.changes.map((path) => `changed ${path}`)
];
