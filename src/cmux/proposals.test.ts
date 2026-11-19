import { expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTERS } from '@/adapters';
import { FILES, FOLDERS } from '@/config';
import type { StartInput } from '@/proposals/adapter';
import { EMPTY_LEDGER, readProposalLedger, writeProposalLedger } from '@/proposals/ledger';
import { addProposals } from '@/proposals/rules';
import { decideProposal } from '@/proposals/start';
import type { CmuxCall } from './app';
import { cmuxAdapter, cmuxAdapterWith } from './proposals';

const HOME = join('/Users', 'ada', 'My Agents', 'Nova');
const PROMPT_FILE = join(HOME, '.state', 'proposals', 'p-a1.prompt');

const recorder = (result: CmuxCall = { ok: true, output: 'OK workspace:7' }) => {
  const calls: string[][] = [];
  const run = (args: string[]): CmuxCall => {
    calls.push(args);
    return result;
  };
  // Publishing redraws the installed sidebar, which these tests leave alone.
  const adapter = { ...cmuxAdapterWith(run), publish: () => {} };
  return { adapter, calls };
};

const valueOf = (args: readonly string[], flag: string): string => args[args.indexOf(flag) + 1] ?? '';

test('the cmux adapter is registered', () => {
  expect(ADAPTERS).toContain(cmuxAdapter);
});

test('a process inside cmux is located by its surface and workspace; one outside, or half inside, is not', () => {
  expect(cmuxAdapter.locate({ CMUX_SURFACE_ID: 'surface-1', CMUX_WORKSPACE_ID: 'workspace-1' })).toEqual({
    adapter: 'cmux',
    surfaceId: 'surface-1',
    workspaceId: 'workspace-1'
  });
  expect(cmuxAdapter.locate({ CMUX_SURFACE_ID: 'surface-1' })).toBeNull();
  expect(cmuxAdapter.locate({ CMUX_SURFACE_ID: '', CMUX_WORKSPACE_ID: 'workspace-1' })).toBeNull();
  expect(cmuxAdapter.locate({})).toBeNull();
});

test('Start opens a workspace in the home whose command names neither the home nor the prompt file', () => {
  const { adapter, calls } = recorder();
  const said = adapter.start({
    home: HOME,
    proposal: { id: 'p-a1', title: 'Reply to the supplier' },
    promptFile: PROMPT_FILE,
    launcher: 'agent'
  });
  expect(said).toBe('Opened it in a new cmux workspace.');
  expect(calls).toEqual([
    [
      'new-workspace',
      '--cwd',
      HOME,
      '--name',
      'Reply to the supplier',
      '--env',
      `AGENT_PROPOSAL_PROMPT=${PROMPT_FILE}`,
      '--command',
      'agent "$(cat "$AGENT_PROPOSAL_PROMPT")"'
    ]
  ]);
});

test('a cmux that refuses throws its own words, so the core puts the proposal back', () => {
  const { adapter } = recorder({ ok: false, output: 'Error: not running inside cmux' });
  const input: StartInput = {
    home: HOME,
    proposal: { id: 'p-a1', title: 'Reply' },
    promptFile: PROMPT_FILE,
    launcher: 'claude'
  };
  expect(() => adapter.start(input)).toThrow('Error: not running inside cmux');
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
  expect(said).toBe('Started: Reply to the review. Opened it in a new cmux workspace.');
  const [args = []] = calls;
  const file = valueOf(args, '--env').replace('AGENT_PROPOSAL_PROMPT=', '');
  expect(readFileSync(file, 'utf-8')).toBe(prompt);
  expect(args.join('\n')).not.toContain('whoami');
  expect(valueOf(args, '--command')).not.toContain(FOLDERS.HOME);
  expect(readProposalLedger().proposals[0]?.state).toBe('started');
  rmSync(FILES.PROPOSALS, { force: true });
  rmSync(file, { force: true });
});
