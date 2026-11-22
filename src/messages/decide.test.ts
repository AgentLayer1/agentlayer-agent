import { expect, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FILES, FOLDERS } from '@/config';
import type { SessionLauncher, SessionPlace, StartContext, StartInput } from '@/sessions/launch';
import { runProposalsCommand } from '@/proposals/command';
import { proposalMessages } from '@/proposals/kind';
import { EMPTY_LEDGER, readProposalLedger, writeProposalLedger } from '@/proposals/ledger';
import { addProposals, type ProposalInput } from '@/proposals/rules';
import { decideMessage } from './decide';

const NOW = new Date('2026-11-20T10:00:00+08:00');

const input: ProposalInput = {
  source: 'task:aa-001',
  title: 'Reply to the review',
  trigger: 'A review came in',
  quote: '',
  detail: 'Drafts the reply.',
  reach: 'Drafts only.',
  estimate: '5m',
  due: '',
  prompt: `Reply to the review on PR 12; leave $HOME and \`whoami\` alone.`
};

const seed = (): string => {
  rmSync(FILES.PROPOSALS, { force: true });
  const { ledger, added } = addProposals(EMPTY_LEDGER, [input], NOW);
  writeProposalLedger(ledger);
  return added[0]?.id ?? '';
};

const PLACE: SessionPlace = { adapter: 'cmux', surfaceId: 's', workspaceId: 'w' };

const fakeAdapter = (reachable: boolean, fail = false) => {
  const started: StartInput[] = [];
  const places: SessionPlace[] = [];
  const adapter: SessionLauncher = {
    name: 'cmux',
    locate: () => (reachable ? PLACE : null),
    start: (input, place) => {
      if (fail) {
        throw new Error('cmux is not running');
      }
      started.push(input);
      places.push(place);
      return 'Opened a workspace.';
    }
  };
  return { adapter, started, places };
};

const context = (adapters: readonly SessionLauncher[]): StartContext => ({
  home: FOLDERS.HOME,
  adapters,
  env: {},
  now: NOW
});

test('Start hands the prompt as a file to the launcher that can reach this session, with its place', () => {
  const id = seed();
  const { adapter, started, places } = fakeAdapter(true);
  expect(decideMessage(proposalMessages, id, 'start', context([adapter]))).toBe('Started: Reply to the review. Opened a workspace.');
  expect(started).toHaveLength(1);
  expect(places).toEqual([PLACE]);
  expect(readFileSync(started[0]?.promptFile ?? '', 'utf-8')).toBe(input.prompt);
  expect(readProposalLedger().proposals[0]?.state).toBe('started');
});

test('a Start the surface placed opens in the workspace it picked, beside nothing else', () => {
  const id = seed();
  const { adapter, places } = fakeAdapter(true);
  decideMessage(proposalMessages, id, 'start', { ...context([adapter]), workspace: 'workspace-9' });
  expect(places).toEqual([{ ...PLACE, workspaceId: 'workspace-9' }]);
});

test('a second Start opens nothing', () => {
  const id = seed();
  const { adapter, started } = fakeAdapter(true);
  decideMessage(proposalMessages, id, 'start', context([adapter]));
  expect(decideMessage(proposalMessages, id, 'start', context([adapter]))).toBe('Reply to the review: already started.');
  expect(started).toHaveLength(1);
});

test('with no adapter that can reach this session, Start says what to run, and the prompt stays in its file', () => {
  const id = seed();
  const { adapter, started } = fakeAdapter(false);
  const message = decideMessage(proposalMessages, id, 'start', context([adapter]));
  expect(started).toHaveLength(0);
  expect(message).toStartWith(`Started: Reply to the review. To start it, run from ${FOLDERS.HOME}: `);
  expect(message).not.toContain('PR 12');
  expect(readdirSync(FOLDERS.PROMPTS)).toContain(`${id}.prompt`);
  expect(decideMessage(proposalMessages, seed(), 'start', context([]))).toContain('To start it, run from');
});

test('a Start whose session cannot open puts the proposal back', () => {
  const id = seed();
  const { adapter } = fakeAdapter(true, true);
  expect(decideMessage(proposalMessages, id, 'start', context([adapter]))).toBe("Couldn't start Reply to the review: cmux is not running");
  expect(readProposalLedger().proposals[0]?.state).toBe('waiting');
});

test('Later and Dismiss record the choice', () => {
  const later = fakeAdapter(true);
  expect(decideMessage(proposalMessages, seed(), 'later', context([later.adapter]))).toBe(
    'Later: Reply to the review comes back in the morning.'
  );
  expect(readProposalLedger().proposals.at(-1)?.laterUntil).not.toBe('');
  expect(decideMessage(proposalMessages, seed(), 'dismiss', context([]))).toBe('Dismissed: Reply to the review.');
  expect(decideMessage(proposalMessages, 'p-none', 'dismiss', context([]))).toBe('No proposal p-none.');
});

test('a ledger that won’t parse is never written over, a Start on it opens nothing, and the list fails rather than show none', () => {
  const id = seed();
  const broken = `${readFileSync(FILES.PROPOSALS, 'utf-8')}}`;
  mkdirSync(dirname(FILES.PROPOSALS), { recursive: true });
  writeFileSync(FILES.PROPOSALS, broken);
  expect(() => writeProposalLedger(EMPTY_LEDGER)).toThrow('is not valid JSON');
  const { adapter, started } = fakeAdapter(true);
  expect(decideMessage(proposalMessages, id, 'start', context([adapter]))).toContain('is not valid JSON');
  expect(started).toHaveLength(0);
  expect(runProposalsCommand('list', ['--json'])).toBe(1);
  expect(readFileSync(FILES.PROPOSALS, 'utf-8')).toBe(broken);
  rmSync(FILES.PROPOSALS, { force: true });
});


test("a prompt file that can't be written leaves the proposal waiting, with the error, instead of started", () => {
  const id = seed();
  rmSync(FOLDERS.PROMPTS, { recursive: true, force: true });
  mkdirSync(dirname(FOLDERS.PROMPTS), { recursive: true });
  writeFileSync(FOLDERS.PROMPTS, 'a file where the folder goes');
  try {
    const { adapter, started } = fakeAdapter(true);
    expect(decideMessage(proposalMessages, id, 'start', context([adapter]))).toStartWith("Couldn't start Reply to the review:");
    expect(started).toHaveLength(0);
    expect(readProposalLedger().proposals[0]?.state).toBe('waiting');
  } finally {
    rmSync(FOLDERS.PROMPTS, { force: true });
  }
});
