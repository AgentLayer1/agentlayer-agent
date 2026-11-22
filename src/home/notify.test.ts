import { expect, test } from 'bun:test';
import type { NoteContext } from '@/notes/adapter';
import type { Note } from '@/notes/ledger';
import { appleScriptString, macNotesAdapterWith } from './notify';

const NOTE: Note = {
  id: 'n-1',
  at: '',
  source: 's',
  lens: 'signals',
  title: 'A "quoted" \\ title',
  body: '',
  sources: [],
  next: '',
  prompt: '',
  reaction: '',
  delivered: []
};

const context = (heartbeat: NoteContext['heartbeat']): NoteContext => ({ home: '/h', agentName: 'Oppi', env: {}, now: new Date(), heartbeat });

test('a title becomes an AppleScript string that quotes and backslashes cannot break out of', () => {
  expect(appleScriptString('A "quoted" \\ title')).toBe('"A \\"quoted\\" \\\\ title"');
});

test('a Mac with no cmux heartbeat gets a plain notification naming where the note is; cmux or another OS gets none', () => {
  const calls: string[][] = [];
  const adapter = macNotesAdapterWith((argv) => (calls.push(argv), true), 'darwin', () => true);
  const inCmux = context({ adapter: 'cmux', surfaceId: 's', workspaceId: 'w' });
  expect(adapter.available(context(null))).toBe(true);
  expect(adapter.available(inCmux)).toBe(false);
  expect(macNotesAdapterWith(() => true, 'darwin', () => false).available(inCmux), 'cmux on record but gone').toBe(true);
  expect(macNotesAdapterWith(() => true, 'win32', () => false).available(context(null))).toBe(false);
  adapter.deliver?.(NOTE, context(null));
  expect(calls).toEqual([
    [
      '/usr/bin/osascript',
      '-e',
      'display notification "A \\"quoted\\" \\\\ title · in the heartbeat\'s tab and reports/notes" with title "Oppi · Note"'
    ]
  ]);
});
