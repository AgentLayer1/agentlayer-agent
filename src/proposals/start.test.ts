import { expect, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { FILES, FOLDERS } from '@/config';
import type { ProposalAdapter, SessionPlace, StartInput } from './adapter';
import { EMPTY_LEDGER, readProposalLedger, writeProposalLedger } from './ledger';
import { addProposals, type ProposalInput } from './rules';
import { decideProposal, type DecideContext } from './start';

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
  const published: string[] = [];
  const adapter: ProposalAdapter = {
    name: 'cmux',
    locate: () => (reachable ? PLACE : null),
    start: (input, place) => {
      if (fail) {
        throw new Error('cmux is not running');
      }
      started.push(input);
      places.push(place);
      return 'Opened a workspace.';
    },
    publish: (home) => published.push(home)
  };
  return { adapter, started, places, published };
};

const context = (adapters: readonly ProposalAdapter[]): DecideContext => ({
  home: FOLDERS.HOME,
  adapters,
  env: {},
  now: NOW
});

test('Start hands the prompt as a file to the adapter that can reach this session, with its place, then publishes', () => {
  const id = seed();
  const { adapter, started, places, published } = fakeAdapter(true);
  expect(decideProposal(id, 'start', context([adapter]))).toBe('Started: Reply to the review. Opened a workspace.');
  expect(started).toHaveLength(1);
  expect(places).toEqual([PLACE]);
  expect(readFileSync(started[0]?.promptFile ?? '', 'utf-8')).toBe(input.prompt);
  expect(published).toEqual([FOLDERS.HOME]);
  expect(readProposalLedger().proposals[0]?.state).toBe('started');
});

test('a second Start opens nothing', () => {
  const id = seed();
  const { adapter, started } = fakeAdapter(true);
  decideProposal(id, 'start', context([adapter]));
  expect(decideProposal(id, 'start', context([adapter]))).toBe('Reply to the review: already started.');
  expect(started).toHaveLength(1);
});

test('with no adapter that can reach this session, Start says what to run, and the prompt stays in its file', () => {
  const id = seed();
  const { adapter, started } = fakeAdapter(false);
  const message = decideProposal(id, 'start', context([adapter]));
  expect(started).toHaveLength(0);
  expect(message).toStartWith(`Started: Reply to the review. To start it, run from ${FOLDERS.HOME}: `);
  expect(message).not.toContain('PR 12');
  expect(readdirSync(FOLDERS.PROPOSAL_PROMPTS)).toContain(`${id}.prompt`);
  expect(decideProposal(seed(), 'start', context([]))).toContain('To start it, run from');
});

test('a Start whose session cannot open puts the proposal back', () => {
  const id = seed();
  const { adapter } = fakeAdapter(true, true);
  expect(decideProposal(id, 'start', context([adapter]))).toBe("Couldn't start Reply to the review: cmux is not running");
  expect(readProposalLedger().proposals[0]?.state).toBe('waiting');
});

test('Later and Skip record the choice and publish', () => {
  const later = fakeAdapter(true);
  expect(decideProposal(seed(), 'later', context([later.adapter]))).toBe(
    'Later: Reply to the review comes back in the morning.'
  );
  expect(later.published).toHaveLength(1);
  expect(decideProposal(seed(), 'skip', context([]))).toBe('Skipped: Reply to the review.');
  expect(decideProposal('p-none', 'skip', context([]))).toBe('No proposal p-none.');
});

test('a ledger that won’t parse is never written over, and a Start on it opens nothing', () => {
  const id = seed();
  const broken = `${readFileSync(FILES.PROPOSALS, 'utf-8')}}`;
  mkdirSync(dirname(FILES.PROPOSALS), { recursive: true });
  writeFileSync(FILES.PROPOSALS, broken);
  expect(() => writeProposalLedger(EMPTY_LEDGER)).toThrow('is not valid JSON');
  const { adapter, started } = fakeAdapter(true);
  expect(decideProposal(id, 'start', context([adapter]))).toBe(`No proposal ${id}.`);
  expect(started).toHaveLength(0);
  expect(readFileSync(FILES.PROPOSALS, 'utf-8')).toBe(broken);
  rmSync(FILES.PROPOSALS, { force: true });
});

test('the core never imports an adapter', () => {
  const dir = resolve(import.meta.dir);
  const sources = readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  const logic = sources.filter((name) => !['tool.ts', 'command.ts'].includes(name));
  const offenders = logic.filter((name) => /from '@\/(cmux|adapters)/.test(readFileSync(resolve(dir, name), 'utf-8')));
  expect(logic.length).toBeGreaterThan(4);
  expect(offenders).toEqual([]);
});
