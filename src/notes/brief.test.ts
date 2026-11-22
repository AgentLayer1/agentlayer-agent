import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FILES } from '@/config';
import { parsePublic, scoutBrief } from './brief';
import { runNotesCommand } from './command';
import { EMPTY_NOTES, writeNotes, type Note, type NoteLedger } from './ledger';
import { WEB_LENSES } from './lenses';
import { pickLens } from './rules';

const NOW = new Date('2026-11-22T10:00:00+08:00');

const PUBLIC = [
  '---',
  'title: Public',
  '---',
  '## Names',
  '- Acme Widgets',
  '- Call Ada on +60 12-345 6789',
  '## Sites',
  '- https://acme.example',
  '- http://acme.example',
  '- https://acme.example/search?q=1',
  '- https://user:pw@acme.example',
  '## Facts',
  '- Acme Widgets 2.0 is the current release',
  '- Registration No. 202601021416',
  '- Write to ada@acme.example',
  '## Place',
  '- Springfield 63000',
  '- Springfield, Freedonia',
  '## Unknown',
  '- dropped quietly'
].join('\n');

const note = (overrides: Partial<Note>): Note => ({
  id: 'n-1',
  at: '2026-11-21T09:00:00+08:00',
  source: 'site:acme',
  lens: 'public-drift',
  title: 'A finding',
  body: 'Body.',
  sources: ['https://acme.example'],
  next: 'Fix it.',
  state: 'waiting',
  decidedAt: '',
  laterUntil: '',
  folder: '',
  workspace: '',
  ...overrides
});

afterEach(() => {
  rmSync(FILES.PUBLIC, { force: true });
  writeNotes(EMPTY_NOTES);
});

test('the public file keeps only what may leave the machine: no email, long number, phone, or non-https or query link', () => {
  const { facts, refused } = parsePublic(PUBLIC);
  expect(facts).toEqual({
    names: ['Acme Widgets'],
    sites: ['https://acme.example'],
    facts: ['Acme Widgets 2.0 is the current release'],
    topics: [],
    place: ['Springfield, Freedonia']
  });
  expect(refused.map(({ line }) => line)).toEqual([
    'Call Ada on +60 12-345 6789',
    'http://acme.example',
    'https://acme.example/search?q=1',
    'https://user:pw@acme.example',
    'Registration No. 202601021416',
    'Write to ada@acme.example',
    'Springfield 63000'
  ]);
});

test('the lens is the one quietest longest, past one whose notes were mostly dismissed', () => {
  const record = {
    brain: { lastAt: '2026-11-20T09:00:00+08:00', notes: 1, started: 1, dismissed: 0 },
    waiting: { lastAt: '2026-11-10T09:00:00+08:00', notes: 3, started: 0, dismissed: 3 },
    signals: { lastAt: '2026-11-15T09:00:00+08:00', notes: 2, started: 1, dismissed: 1 }
  };
  expect(pickLens(record, ['brain', 'waiting', 'signals'])).toBe('signals');
  expect(pickLens(record, ['brain', 'waiting', 'signals', 'opportunities'])).toBe('opportunities');
  expect(pickLens({ waiting: record.waiting }, ['waiting'])).toBe('waiting');
  const tie = { lastAt: '2026-11-15T09:00:00+08:00', notes: 2, started: 0, dismissed: 0 };
  expect(pickLens({ brain: tie, signals: { ...tie, started: 2 } }, ['brain', 'signals'])).toBe('signals');
});

test("the scout's brief carries the public facts and nothing from the ledger but the day's room", () => {
  const [lens] = WEB_LENSES;
  const ledger: NoteLedger = {
    notes: [
      note({}),
      note({ id: 'n-2', source: 'task:aa-001', lens: 'brain', title: 'Ada owes a reply' }),
      note({ id: 'n-3', source: 'event:old', at: '2026-09-01T09:00:00+08:00', state: 'dismissed' })
    ]
  };
  const text = scoutBrief(parsePublic(PUBLIC).facts, lens, ledger, NOW);
  expect(text).toContain('Lens: public-drift.');
  expect(text).toContain('Month: November 2026');
  expect(text).toContain('- https://acme.example');
  expect(text).toContain('Room: at most 3 notes today.');
  expect(text).not.toContain('site:acme');
  expect(text).not.toContain('task:aa-001');
  expect(text).not.toContain('Ada');
  expect(text).not.toContain(FILES.PUBLIC);
});

const briefJson = (): unknown => {
  const said = spyOn(console, 'log').mockImplementation(() => {});
  const warned = spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(runNotesCommand('brief', ['--json'])).toBe(0);
    return JSON.parse(String(said.mock.calls[0]?.[0] ?? ''));
  } finally {
    said.mockRestore();
    warned.mockRestore();
  }
};

test('with no public file only a home lens runs, and with one a web lens gets its brief', () => {
  expect(briefJson()).toEqual({ lens: 'brain', prompt: '' });
  writeNotes({
    notes: [note({ lens: 'brain', source: 'task:aa-001' }), note({ id: 'n-2', lens: 'waiting', source: 'pr:1' })]
  });
  mkdirSync(dirname(FILES.PUBLIC), { recursive: true });
  writeFileSync(FILES.PUBLIC, PUBLIC);
  expect(briefJson()).toMatchObject({
    lens: 'public-drift',
    prompt: expect.stringContaining('Acme Widgets')
  });
});
