import { expect, test } from 'bun:test';
import type { NoteContext } from '@/notes/adapter';
import type { Note } from '@/notes/ledger';
import { cmuxNotesAdapterWith } from './notes';

const NOTE: Note = {
  id: 'n-1',
  at: '',
  source: 'site:snippet',
  lens: 'public-drift',
  title: 'The snippet names the old plugin',
  body: '',
  sources: [],
  next: '',
  state: 'waiting',
  decidedAt: '',
  laterUntil: '',
  folder: '',
  workspace: ''
};

const CONTEXT: NoteContext = { agentName: 'Oppi' };

const PLACE = { adapter: 'cmux', surfaceId: 's-1', workspaceId: 'w-1' } as const;

test("the notification goes to the heartbeat's tab, as a desktop notification", () => {
  const calls: string[][] = [];
  const adapter = cmuxNotesAdapterWith((args) => (calls.push(args), { ok: true, output: '' }), () => true, () => PLACE);
  adapter.deliver?.(NOTE, CONTEXT);
  expect(calls).toEqual([
    ['notify', '--title', 'Oppi · Note', '--body', 'The snippet names the old plugin', '--surface', 's-1', '--workspace', 'w-1', '--desktop', 'true']
  ]);
});

test('it is available only with cmux installed and a heartbeat in a cmux tab, and a refusal throws', () => {
  const ok = cmuxNotesAdapterWith(() => ({ ok: false, output: 'not running' }), () => true, () => PLACE);
  expect(ok.available()).toBe(true);
  expect(cmuxNotesAdapterWith(() => ({ ok: true, output: '' }), () => true, () => null).available()).toBe(false);
  expect(cmuxNotesAdapterWith(() => ({ ok: true, output: '' }), () => false, () => PLACE).available()).toBe(false);
  expect(() => ok.deliver?.(NOTE, CONTEXT)).toThrow('not running');
});
