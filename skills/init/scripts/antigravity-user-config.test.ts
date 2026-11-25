import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUserConfig, type UserConfigInputs } from './antigravity-user-config';

const SCRATCH = realpathSync(mkdtempSync(join(tmpdir(), 'antigravity-user-config-')));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));
const HOME = join(SCRATCH, 'Nova');
const CHECKOUT = join(SCRATCH, 'acme-plugin');
const CODE = join(SCRATCH, 'code');
const VAULT = join(SCRATCH, 'vault');
[HOME, CHECKOUT, join(CODE, 'acme'), VAULT].forEach((folder) => mkdirSync(folder, { recursive: true }));
symlinkSync(CHECKOUT, join(SCRATCH, 'linked-plugin'));

const inputs = (overrides: Partial<UserConfigInputs> = {}): UserConfigInputs => ({
  home: HOME,
  checkout: CHECKOUT,
  manifest: {},
  settings: {},
  claudeUser: {
    permissions: {
      deny: [
        `Read(/${VAULT}/**)`,
        `Read(/${VAULT}/keys.txt)`,
        `Read(/${SCRATCH}/wallets/**/acme*/**)`,
        'Read(**/.env)',
        `Read(/${CODE}/**/token*)`,
        `Edit(/${SCRATCH}/profile.sh)`,
        `Edit(/${VAULT}/notes.txt)`,
        'Bash(sudo *)',
        'Bash(git push --force*)',
        'Bash(curl *|sh*)'
      ]
    },
    sandbox: { network: { allowedDomains: ['github.com', '*.npmjs.org'] } }
  },
  codeRoots: [CODE, join(CODE, 'acme')],
  claudeHome: { sandbox: { filesystem: { allowWrite: [join(SCRATCH, 'cache')] } } },
  filesUnder: () => [],
  ...overrides
});

describe('the plugins manifest', () => {
  test('missing, an entry to add, or current however the path to the checkout is spelled', () => {
    expect(buildUserConfig(inputs()).manifest).toBe('missing');
    expect(buildUserConfig(inputs({ manifest: { entries: [{ path: SCRATCH }] } })).manifest).toBe('add-entry');
    const linked = { entries: [{ path: join(SCRATCH, 'linked-plugin') }] };
    expect(buildUserConfig(inputs({ manifest: linked })).manifest).toBe('current');
  });
});

describe('the CLI settings', () => {
  const { settings, heldByHook } = buildUserConfig(inputs());
  const deny = settings.permissions?.deny ?? [];
  const allow = settings.permissions?.allow ?? [];

  test('turn the sandbox on', () => {
    expect(settings.enableTerminalSandbox).toBe(true);
  });

  test("deny the home's secrets and each Claude deny as a resolved path, folder rules covering what they hold", () => {
    expect(deny).toContain(`read_file(${join(HOME, '.state', 'secrets')})`);
    expect(deny).toContain(`read_file(${VAULT})`);
    expect(deny).not.toContain(`read_file(${join(VAULT, 'keys.txt')})`);
    expect(deny).toContain(`read_file(${join(SCRATCH, 'wallets')})`);
    expect(deny).toContain(`write_file(${join(SCRATCH, 'profile.sh')})`);
    ['.agents', '.claude', '.codex', '.mcp.json'].forEach((name) =>
      expect(deny).toContain(`write_file(${join(HOME, name)})`)
    );
    expect(deny).not.toContain(`write_file(${join(VAULT, 'notes.txt')})`);
    expect(deny).toEqual(expect.arrayContaining(['command(sudo)', 'command(git push --force)']));
  });

  test('no path rule holds a glob; a wildcard over the work or everywhere stays with the hook', () => {
    const pathTargets = [...deny, ...allow].flatMap((rule) => /^(?:read|write)_file\((.*)\)$/.exec(rule)?.[1] ?? []);
    expect(pathTargets.length).toBeGreaterThan(5);
    expect(pathTargets.filter((target) => /[*?[\]{}]/.test(target))).toEqual([]);
    expect(heldByHook).toEqual(['**/.env', `${CODE}/**/token*`]);
  });

  test('allow the checkout read, the outermost folders the agent writes, and the domains', () => {
    expect(allow).toEqual([
      `read_file(${CHECKOUT})`,
      `write_file(${CODE})`,
      `write_file(${join(SCRATCH, 'cache')})`,
      'read_url(github.com)',
      'read_url(npmjs.org)'
    ]);
  });

  test("list only what the user's file lacks", () => {
    const current = { enableTerminalSandbox: true, permissions: { allow, deny } };
    expect(buildUserConfig(inputs({ settings: current })).settings).toEqual({});
  });
});

test("a wildcard under the user's whole home is never widened to it", () => {
  const broad = inputs({ claudeUser: { permissions: { deny: ['Read(~/*.key)'] } } });
  const { settings, heldByHook } = buildUserConfig(broad);
  expect(settings.permissions?.deny?.some((rule) => rule === `read_file(${homedir()})`)).toBe(false);
  expect(heldByHook).toEqual([join(homedir(), '*.key')]);
});

describe('a wildcard deny over the work', () => {
  const WORK = join(SCRATCH, 'work');
  const files: Record<string, string[]> = {
    [HOME]: [join(HOME, '.env'), join(HOME, 'private', 'plan.md'), join(HOME, 'notes.md')],
    [CODE]: [join(CODE, 'acme', '.env'), join(CODE, 'acme', 'src', 'app.ts'), join(CODE, 'acme', 'src', 'id.pem')],
    [WORK]: [join(WORK, 'site', '.env')]
  };
  const filesUnder = (root: string): string[] => files[root] ?? [];
  const deniesOf = (overrides: Partial<UserConfigInputs>): string[] =>
    buildUserConfig(inputs({ filesUnder, ...overrides })).settings.permissions?.deny ?? [];

  test('is denied file by file for what matches today, in the home and every folder the agent works in', () => {
    const deny = deniesOf({ claudeUser: { permissions: { deny: ['Read(**/.env)'] } } });
    [join(HOME, '.env'), join(CODE, 'acme', '.env')].forEach((file) => expect(deny).toContain(`read_file(${file})`));
    expect(deny).not.toContain(`read_file(${join(HOME, 'notes.md')})`);
  });

  test("a home's own wildcard applies in the home only", () => {
    const claudeHome = { permissions: { deny: ['Read(./private/**)', 'Read(**/*.pem)'] } };
    const deny = deniesOf({ claudeUser: {}, claudeHome });
    expect(deny).toContain(`read_file(${join(HOME, 'private', 'plan.md')})`);
    expect(deny).not.toContain(`read_file(${join(CODE, 'acme', 'src', 'id.pem')})`);
  });

  test('never widens to a folder the agent writes, however that folder is granted or spelled', () => {
    const viaAllowWrite = deniesOf({
      claudeUser: { permissions: { deny: [`Read(/${WORK}/**/.env)`] } },
      claudeHome: { sandbox: { filesystem: { allowWrite: [WORK] } } }
    });
    expect(viaAllowWrite).not.toContain(`read_file(${WORK})`);
    expect(viaAllowWrite).toContain(`read_file(${join(WORK, 'site', '.env')})`);
    const belowCodeRoot = deniesOf({ claudeUser: { permissions: { deny: [`Read(/${CODE}/acme/src/*.pem)`] } } });
    expect(belowCodeRoot).not.toContain(`read_file(${join(CODE, 'acme', 'src')})`);
    expect(belowCodeRoot).toContain(`read_file(${join(CODE, 'acme', 'src', 'id.pem')})`);
    const linked = deniesOf({
      claudeUser: { permissions: { deny: [`Read(/${join(SCRATCH, 'linked-plugin')}/**/.env)`] } }
    });
    expect(linked).not.toContain(`read_file(${CHECKOUT})`);
  });
});
