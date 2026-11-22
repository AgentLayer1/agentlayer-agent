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
  prompt: '',
  reaction: ''
};

const context = (heartbeat: NoteContext['heartbeat']): NoteContext => ({ home: '/h', agentName: 'Oppi', heartbeat });

const PLACE = { adapter: 'cmux', surfaceId: 's-1', workspaceId: 'w-1' } as const;

test("the notification goes to the heartbeat's tab, as a desktop notification", () => {
  const calls: string[][] = [];
  const adapter = cmuxNotesAdapterWith((args) => (calls.push(args), { ok: true, output: '' }), () => true);
  adapter.deliver?.(NOTE, context(PLACE));
  expect(calls).toEqual([
    ['notify', '--title', 'Oppi · Note', '--body', 'The snippet names the old plugin', '--surface', 's-1', '--workspace', 'w-1', '--desktop', 'true']
  ]);
});

test('it is available only with cmux installed and a heartbeat in a cmux tab, and a refusal throws', () => {
  const ok = cmuxNotesAdapterWith(() => ({ ok: false, output: 'not running' }), () => true);
  expect(ok.available(context(PLACE))).toBe(true);
  expect(ok.available(context(null))).toBe(false);
  expect(cmuxNotesAdapterWith(() => ({ ok: true, output: '' }), () => false).available(context(PLACE))).toBe(false);
  expect(() => ok.deliver?.(NOTE, context(PLACE))).toThrow('not running');
});
