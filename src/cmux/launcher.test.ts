import { expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LAUNCHERS } from '@/adapters';
import { FILES, FOLDERS } from '@/config';
import type { SessionPlace, StartInput } from '@/sessions/launch';
import { EMPTY_LEDGER, readProposalLedger, writeProposalLedger } from '@/proposals/ledger';
import { addProposals } from '@/proposals/rules';
import { decideProposal } from '@/proposals/start';
import type { CmuxCall } from './app';
import { cmuxLauncher, cmuxLauncherWith } from './launcher';

const HOME = join('/Users', 'ada', 'My Agents', 'Nova');
const PROMPT_FILE = join(HOME, '.state', 'proposals', 'p-a1.prompt');

const recorder = (result: CmuxCall = { ok: true, output: 'OK workspace:7' }) => {
  const calls: string[][] = [];
  const run = (args: string[]): CmuxCall => {
    calls.push(args);
    return result;
  };
  const adapter = cmuxLauncherWith(run);
  return { adapter, calls };
};

const valueOf = (args: readonly string[], flag: string): string => args[args.indexOf(flag) + 1] ?? '';

test('the cmux launcher is registered', () => {
  expect(LAUNCHERS).toContain(cmuxLauncher);
});

test('a process inside cmux is located by its surface and workspace; one outside, or half inside, is not', () => {
  expect(cmuxLauncher.locate({ CMUX_SURFACE_ID: 'surface-1', CMUX_WORKSPACE_ID: 'workspace-1' })).toEqual({
    adapter: 'cmux',
    surfaceId: 'surface-1',
    workspaceId: 'workspace-1'
  });
  expect(cmuxLauncher.locate({ CMUX_SURFACE_ID: 'surface-1' })).toBeNull();
  expect(cmuxLauncher.locate({ CMUX_SURFACE_ID: '', CMUX_WORKSPACE_ID: 'workspace-1' })).toBeNull();
  expect(cmuxLauncher.locate({})).toBeNull();
});

const PLACE: SessionPlace = { adapter: 'cmux', surfaceId: 'surface-1', workspaceId: 'workspace-1' };

const startInput = (promptFile: string = PROMPT_FILE): StartInput => ({
  home: HOME,
  promptFile,
  launcher: 'agent'
});

test('Start selects the workspace and opens a focused tab whose command names neither the home nor the prompt', () => {
  const { adapter, calls } = recorder();
  expect(adapter.start(startInput(), PLACE)).toBe('Opened it in a new tab.');
  expect(calls).toEqual([
    ['select-workspace', '--workspace', 'workspace-1'],
    [
      'new-surface',
      '--workspace',
      'workspace-1',
      '--working-directory',
      HOME,
      '--focus',
      'true',
      '--command',
      `agent "$(cat '${join('.state', 'proposals', 'p-a1.prompt')}')"`
    ]
  ]);
});

test('a prompt file outside the home opens nothing, and a quote in its path stays inside the quoting', () => {
  const { adapter, calls } = recorder();
  expect(() => adapter.start(startInput(join('/Users', 'ada', 'p-a1.prompt')), PLACE)).toThrow('inside the home');
  expect(calls).toEqual([]);
  adapter.start(startInput(join(HOME, '.state', "it's.prompt")), PLACE);
  expect(calls.at(-1)?.at(-1)).toBe(`agent "$(cat '${join('.state', "it'\\''s.prompt")}')"`);
});

test('a cmux that refuses throws its own words, so the core puts the proposal back', () => {
  const { adapter } = recorder({ ok: false, output: 'Error: not running inside cmux' });
  expect(() => adapter.start(startInput(), PLACE)).toThrow('Error: not running inside cmux');
});

test('a Start through the core passes the prompt only as a file the new shell reads', () => {
  rmSync(FILES.PROPOSALS, { force: true });
  const prompt = 'Reply on PR 12; leave $HOME and `whoami` alone.';
  const { ledger, added } = addProposals(
    EMPTY_LEDGER,
    [
      {
        source: 'task:aa-001',
        title: 'Reply to the review',
        trigger: '',
        quote: '',
        detail: '',
        reach: '',
        estimate: '5m',
        due: '',
        prompt
      }
    ],
    new Date('2026-11-09T10:00:00Z')
  );
  writeProposalLedger(ledger);
  const id = added[0]?.id ?? '';
  const { adapter, calls } = recorder();
  const env = { CMUX_SURFACE_ID: 'surface-1', CMUX_WORKSPACE_ID: 'workspace-1' };
  const said = decideProposal(id, 'start', { home: FOLDERS.HOME, adapters: [adapter], env, now: new Date() });
  expect(said).toBe('Started: Reply to the review. Opened it in a new tab.');
  const args = calls.find((call) => call[0] === 'new-surface') ?? [];
  expect(valueOf(args, '--workspace')).toBe('workspace-1');
  expect(valueOf(args, '--working-directory')).toBe(FOLDERS.HOME);
  const command = valueOf(args, '--command');
  const file = join(FOLDERS.HOME, command.match(/cat '([^']+)'/)?.[1] ?? '');
  expect(readFileSync(file, 'utf-8')).toBe(prompt);
  expect(args.join('\n')).not.toContain('whoami');
  expect(command).not.toContain(FOLDERS.HOME);
  expect(readProposalLedger().proposals[0]?.state).toBe('started');
  rmSync(FILES.PROPOSALS, { force: true });
  rmSync(file, { force: true });
});
