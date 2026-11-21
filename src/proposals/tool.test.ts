import { expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { FILES } from '@/config';
import { readProposalLedger } from './ledger';
import { tools } from './tool';

const proposal = (source: string) => ({
  source,
  title: `Do ${source}`,
  trigger: 'Something happened',
  quote: '',
  detail: 'It does the thing and stops.',
  reach: 'Drafts only.',
  estimate: '5m',
  due: '',
  folder: '',
  workspace: '',
  prompt: `Work on ${source}, then stop.`
});

interface Answer {
  added: { id: string }[];
  retired: { id: string }[];
  keptShowing: { id: string; reason: string }[];
}

const add = (args: { proposals?: ReturnType<typeof proposal>[]; retire?: { id: string; reason: string; for?: string }[] }) => {
  const [tool] = tools;
  if (!tool) {
    throw new Error('proposal_add is missing');
  }
  return tool.handler({ proposals: args.proposals ?? [], retire: args.retire ?? [] }) as Promise<Answer>;
};

test('a card retired for a replacement that is refused stays; one retired for its own reason goes', async () => {
  rmSync(FILES.PROPOSALS, { force: true });
  const { added } = await add({
    proposals: [proposal('task:aa-001'), proposal('task:aa-002'), proposal('task:aa-003')]
  });
  const [first, second] = added.map(({ id }) => id);
  // task:aa-003 is already waiting, so the replacement is refused.
  const answer = await add({
    proposals: [proposal('task:aa-003')],
    retire: [
      { id: first ?? '', reason: 'outranked', for: 'task:aa-003' },
      { id: second ?? '', reason: 'the task closed' }
    ]
  });
  expect(answer.added).toEqual([]);
  expect(answer.retired.map(({ id }) => id)).toEqual([second]);
  expect(answer.keptShowing).toEqual([{ id: first, reason: 'its replacement was refused' }]);
  expect(readProposalLedger().proposals.map(({ state }) => state)).toEqual(['waiting', 'retired', 'waiting']);
  rmSync(FILES.PROPOSALS, { force: true });
});

test('a call with nothing to add or retire is refused', async () => {
  await expect(add({})).rejects.toThrow('Pass proposals to add, retire to withdraw, or both.');
});
