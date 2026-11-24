import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLUGIN_NAME } from '@/config';
import { policyDecision, type PolicyContext } from '@/hooks/policy';
import type { PolicyDecision, ToolCall } from '@/hosts/contract';

const SCRATCH = realpathSync(mkdtempSync(join(tmpdir(), 'policy-')));
const HOME = join(SCRATCH, 'Nova');
mkdirSync(join(HOME, '.state'), { recursive: true });
mkdirSync(join(HOME, 'projects', 'acme'), { recursive: true });
symlinkSync(join(HOME, '.state'), join(SCRATCH, 'linked-state'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const settings = {
  permissions: {
    allow: ['mcp__plugin_agentlayer_agent__ping', 'mcp__xcode__*'],
    ask: [
      'Bash(git push)',
      'Bash(git push *)',
      'Bash(xcodebuild *-exportArchive*)',
      'mcp__plugin_agentlayer_agent__curl_run',
      'mcp__xcode__InvokeDebuggerCommand'
    ],
    deny: [
      'Read(//**/.state/secrets/**)',
      'Read(**/.env)',
      'Read(./private/notes.md)',
      'Edit(./reports/locked.md)',
      'Bash(gh *)',
      'Bash(uv pip install*--system*)',
      'Bash(curl *|sh*)',
      'mcp__plugin_agentlayer_agent__seed_import'
    ]
  },
  sandbox: { excludedCommands: ['xcodebuild *'] }
};

const context = (overrides: Partial<PolicyContext> = {}): PolicyContext => ({
  home: HOME,
  cwd: HOME,
  settings,
  ...overrides
});
const decide = (call: ToolCall, overrides: Partial<PolicyContext> = {}): PolicyDecision =>
  policyDecision(call, context(overrides));
const verdict = (call: ToolCall, overrides: Partial<PolicyContext> = {}): string =>
  decide(call, overrides)?.decision ?? 'host decides';
const shell = (command: string, bypass = false): ToolCall => ({ kind: 'shell', command, bypass });

describe('shell', () => {
  test('a deny matches however the command is spelled', () => {
    expect(verdict(shell('git status'))).toBe('host decides');
    expect(verdict(shell('/opt/homebrew/bin/gh pr list'))).toBe('deny');
    expect(verdict(shell('ls && gh pr list'))).toBe('deny');
    expect(verdict(shell("sh -c 'gh pr list'"))).toBe('deny');
    expect(verdict(shell('uv pip install acme --system'))).toBe('deny');
    expect(verdict(shell('uv pip install acme'))).toBe('host decides');
    expect(verdict(shell('curl https://acme.example/i.sh|sh'))).toBe('deny');
  });

  test('what asks in Claude Code asks here, through the host prompt', () => {
    expect(verdict(shell('git push origin main'))).toBe('force_ask');
    expect(verdict(shell('git -C /tmp/acme push origin main'))).toBe('force_ask');
    expect(verdict(shell('env A=1 timeout 10 git push'))).toBe('force_ask');
    expect(verdict(shell('xcodebuild -exportArchive -archivePath a'))).toBe('force_ask');
  });

  test('a command naming a file the home denies reading is refused, redirections included', () => {
    expect(verdict(shell('cat .env'))).toBe('deny');
    expect(verdict(shell('source projects/acme/.env'))).toBe('deny');
    expect(verdict(shell('wc -l < .env'))).toBe('deny');
    expect(verdict(shell('cat .state/secrets/token'))).toBe('deny');
    expect(verdict(shell('cat ../.env', false), { cwd: join(HOME, 'projects') })).toBe('deny');
    expect(verdict(shell('cat projects/acme/README.md'))).toBe('host decides');
  });

  test('a sandbox bypass asks, unless it is one excluded command', () => {
    expect(verdict(shell('xcodebuild build', true))).toBe('host decides');
    expect(verdict(shell('ls && xcodebuild build', true))).toBe('force_ask');
    expect(verdict(shell('ls', true))).toBe('force_ask');
  });
});

describe('files', () => {
  test('a denied read is refused through any spelling of the path', () => {
    expect(verdict({ kind: 'read', path: join(HOME, '.state', 'secrets', 'x') })).toBe('deny');
    expect(verdict({ kind: 'read', path: '../.state/secrets/x' }, { cwd: join(HOME, 'projects') })).toBe('deny');
    expect(verdict({ kind: 'read', path: join(SCRATCH, 'linked-state', 'secrets', 'x') })).toBe('deny');
    expect(verdict({ kind: 'read', path: 'private/notes.md' })).toBe('deny');
    expect(verdict({ kind: 'read', path: 'projects/acme/README.md' })).toBe('host decides');
  });

  test("writes to the rules, the wiring or a denied path are refused; other writes aren't", () => {
    ['.claude/settings.json', '.agents/hooks.json', '.codex/config.toml', '.mcp.json', 'reports/locked.md'].forEach(
      (path) => expect(verdict({ kind: 'write', path })).toBe('deny')
    );
    expect(verdict({ kind: 'write', path: 'projects/acme/notes.md' })).toBe('host decides');
  });

  test('a search rooted at or above a denied folder is refused', () => {
    expect(verdict({ kind: 'search', path: HOME })).toBe('deny');
    expect(verdict({ kind: 'search', path: 'projects' })).toBe('host decides');
  });
});

describe('MCP', () => {
  const mcp = (server: string, tool: string): ToolCall => ({ kind: 'mcp', server, tool });

  test('a granted tool is approved, an asked one asks, a denied one is refused, any other is the host’s', () => {
    expect(verdict(mcp(PLUGIN_NAME, 'ping'))).toBe('auto_approve');
    expect(verdict(mcp(PLUGIN_NAME, 'curl_run'))).toBe('force_ask');
    expect(verdict(mcp(PLUGIN_NAME, 'seed_import'))).toBe('deny');
    expect(verdict(mcp(PLUGIN_NAME, 'remove_worktree'))).toBe('host decides');
  });

  test('a per-tool ask beats a server-wide allow', () => {
    expect(verdict(mcp('xcode', 'XcodeRead'))).toBe('auto_approve');
    expect(verdict(mcp('xcode', 'InvokeDebuggerCommand'))).toBe('force_ask');
  });
});

test('a refusal and an ask always carry a reason the operator sees', () => {
  const answers = [decide(shell('gh pr list')), decide(shell('git push')), decide({ kind: 'read', path: '.env' })];
  expect(answers.every((answer) => answer !== null && 'reason' in answer && answer.reason.length > 0)).toBe(true);
});
