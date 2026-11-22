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
  reaction: ''
};

const CONTEXT: NoteContext = { home: '/h', agentName: 'Oppi', heartbeat: null };

test('a title becomes an AppleScript string that quotes and backslashes cannot break out of', () => {
  expect(appleScriptString('A "quoted" \\ title')).toBe('"A \\"quoted\\" \\\\ title"');
});

test('a Mac gets a plain notification naming where the note is; another OS gets none', async () => {
  const calls: string[][] = [];
  const adapter = macNotesAdapterWith(async (argv) => (calls.push(argv), true), 'darwin');
  expect(adapter.available(CONTEXT)).toBe(true);
  expect(macNotesAdapterWith(async () => true, 'win32').available(CONTEXT)).toBe(false);
  await adapter.deliver?.(NOTE, CONTEXT);
  expect(calls).toEqual([
    [
      '/usr/bin/osascript',
      '-e',
      'display notification "A \\"quoted\\" \\\\ title · in the heartbeat\'s tab and reports/notes" with title "Oppi · Note"'
    ]
  ]);
});
