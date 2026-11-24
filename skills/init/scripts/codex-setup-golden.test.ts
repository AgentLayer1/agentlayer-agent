import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Codex's whole generated wiring for a home that exercises every branch, pinned so a refactor of the generator
 * shows any change in what it writes.
 */
const SCRIPT = resolve(import.meta.dir, 'codex-setup.ts');
const ROOT = resolve(import.meta.dir, '..', '..', '..');
const SCRATCH = mkdtempSync(join(tmpdir(), 'codex-setup-golden-'));
const HOME = join(SCRATCH, 'Scout');
const USER_CLAUDE = join(SCRATCH, 'user-claude.json');
const USER_CODEX = join(SCRATCH, 'user-codex.toml');

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const put = (path: string, content: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
};

put(join(HOME, '.claude', 'settings.json'), {
  permissions: {
    allow: ['Bash(git status)', 'mcp__plugin_agentlayer_agent__ping', 'mcp__xcode__*'],
    ask: [
      'Bash(git push)',
      'Bash(git push *)',
      'Bash(xcodebuild *-exportArchive*)',
      'mcp__plugin_agentlayer_agent__curl_run',
      'mcp__xcode__InvokeDebuggerCommand'
    ],
    deny: ['Read(//**/.state/secrets/**)', 'Read(./private/notes.md)', 'Bash(gh *)', 'Bash(curl *|sh*)'],
    additionalDirectories: [join(SCRATCH, 'code')]
  },
  sandbox: { network: { allowedDomains: ['pypi.org'] }, excludedCommands: ['xcodebuild *'] },
  env: { AGENT_CODE_PATH: join(SCRATCH, 'code') }
});
put(join(HOME, '.claude', 'settings.local.json'), { enabledMcpjsonServers: ['xcode', 'acme-db', 'acme-env'] });
put(join(HOME, '.mcp.json'), {
  mcpServers: {
    xcode: { command: 'xcrun', args: ['mcpbridge'] },
    'acme-db': { command: 'bun', args: ['db.ts'], env: { DB_URL: 'postgres://localhost/acme' } },
    'acme-env': { command: 'bun', args: ['env.ts'], env: { TOKEN: '${ACME_TOKEN}' } },
    'acme-http': { type: 'http', url: 'https://acme.example/mcp' }
  }
});
put(join(HOME, '.codex', 'hooks.json'), {
  hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo operator-stop', timeout: 2 }] }] }
});
put(join(HOME, '.codex', 'config.toml'), 'model = "operator-model"\n\n[tui]\ntheme = "dark"\n');
put(USER_CLAUDE, { permissions: { deny: ['Read(**/.env)', 'Read(~/.ssh/id_*)'] } });
put(USER_CODEX, 'default_permissions = "mine"\n\n[permissions.mine.filesystem]\n"**/.env" = "none"\n');

const normalize = (text: string): string => text.replaceAll(SCRATCH, '<SCRATCH>').replaceAll(ROOT, '<ROOT>');
const run = (...extra: string[]) => {
  const proc = spawnSync(
    process.execPath,
    [SCRIPT, '--home', HOME, '--claude-user-settings', USER_CLAUDE, '--codex-user-config', USER_CODEX, ...extra],
    { encoding: 'utf-8', env: { ...process.env, HOME: join(SCRATCH, 'user') } }
  );
  return { code: proc.status, stdout: normalize(proc.stdout), stderr: normalize(proc.stderr) };
};
const file = (rel: string): string => normalize(readFileSync(join(HOME, rel), 'utf-8'));

test("Codex's whole wiring for a home with every kind of rule and server", () => {
  const dry = run();
  const written = run('--write');
  expect({
    dry,
    written,
    hooks: file('.codex/hooks.json'),
    config: file('.codex/config.toml'),
    rules: file('.codex/rules/agentlayer.rules')
  }).toMatchSnapshot();
});
