import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { FILES, FOLDERS } from '@/config';
import { localISO, nowISO, shiftDate, todayDate } from '@/shared/date';
import { chosenAdapters, deliverNote, type NoteAdapter, type NoteContext } from './adapter';
import { EMPTY_NOTES, type Note } from './ledger';
import { addNotes, DAILY_CAP, lensRecord, react, roomToday, type NoteInput } from './rules';
import { sendNotes } from './send';
import { reportAdapter } from '@/reports/notes';

const NOW = new Date('2026-11-22T10:00:00+08:00');
const HOUR = 60 * 60 * 1000;

const input = (source: string, fields: Partial<NoteInput> = {}): NoteInput => ({
  source,
  lens: 'public-drift',
  title: `Found ${source}`,
  body: 'What changed, and what was checked.',
  sources: ['https://example.com/page'],
  next: 'Do the one small thing.',
  ...fields
});

const counter = () => {
  let next = 0;
  return () => `n-${(next++).toString(36)}`;
};

test(`at most ${DAILY_CAP} notes go out a day in the home's timezone: 23:59 is still that day, 00:01 has room again`, () => {
  const sent = addNotes(EMPTY_NOTES, ['a', 'b', 'c', 'd'].map((source) => input(source)), NOW, counter());
  expect(sent.added.map(({ source }) => source)).toEqual(['a', 'b', 'c']);
  expect(sent.refused).toEqual([{ source: 'd', title: 'Found d', reason: `${DAILY_CAP} notes already went out today` }]);
  expect(roomToday(sent.ledger, NOW)).toBe(0);
  const today = todayDate(NOW);
  expect(roomToday(sent.ledger, new Date(localISO(today, '23:59')))).toBe(0);
  expect(roomToday(sent.ledger, new Date(localISO(shiftDate(today, 1), '00:01')))).toBe(DAILY_CAP);
});

test('a source noted in the last two weeks is refused, and comes back after', () => {
  const first = addNotes(EMPTY_NOTES, [input('site:snippet')], NOW, counter()).ledger;
  const again = (days: number) => addNotes(first, [input('site:snippet')], new Date(NOW.getTime() + days * 24 * HOUR));
  expect(again(13).refused.map(({ reason }) => reason)).toEqual(['noted in the last two weeks']);
  expect(again(15).added).toHaveLength(1);
});

test('a note with nothing to back it is refused; a brain finding may cite a home file', () => {
  const { refused } = addNotes(EMPTY_NOTES, [input('x', { sources: ['the brain', '~/notes.md'] })], NOW);
  expect(refused.map(({ reason }) => reason)).toEqual(['no source to back it: a URL, or a file in the home']);
  expect(addNotes(EMPTY_NOTES, [input('y', { sources: ['knowledge/memory/index.md'] })], NOW).added, 'a brain finding cites the home').toHaveLength(1);
});

test('reactions record how a note landed, per lens, and an unknown id changes nothing', () => {
  const { ledger } = addNotes(EMPTY_NOTES, [input('a'), input('b', { lens: 'signals' })], NOW, counter());
  const reacted = react(ledger, 'n-0', 'useful');
  expect(react(ledger, 'n-9', 'useful')).toBeNull();
  expect(reacted && lensRecord(reacted)).toEqual({
    'public-drift': { lastAt: nowISO(NOW), notes: 1, useful: 1, dismissed: 0 },
    signals: { lastAt: nowISO(NOW), notes: 1, useful: 0, dismissed: 0 }
  });
});

const CONTEXT: NoteContext = { home: '/h', agentName: 'Oppi' };

const fake = (name: string, available = true, fails = false, fields: Partial<NoteAdapter> = {}) => {
  const got: string[] = [];
  const adapter: NoteAdapter = {
    name,
    ...fields,
    available: () => available,
    deliver: (note) => {
      if (fails) {
        throw new Error('down');
      }
      got.push(note.id);
    }
  };
  return { adapter, got };
};

test('every available adapter delivers, unless AGENT_NOTES_DELIVER names a subset; an always-on one runs regardless', () => {
  const adapters = [fake('report', true, false, { always: true }).adapter, fake('cmux').adapter, fake('mac', false).adapter, fake('slack').adapter];
  const names = (env: Record<string, string>) => chosenAdapters(adapters, CONTEXT, env).map(({ name }) => name);
  expect(names({})).toEqual(['report', 'cmux', 'slack']);
  expect(names({ AGENT_NOTES_DELIVER: 'slack' })).toEqual(['report', 'slack']);
  expect(names({ AGENT_NOTES_DELIVER: 'mac' }), 'a named adapter still has to be available').toEqual(['report']);
});

test('of a group, the first available adapter stands in for the rest, unless the setting leaves it out', () => {
  const notifiers = (first: boolean) => [fake('cmux', first, false, { group: 'notify' }).adapter, fake('mac', true, false, { group: 'notify' }).adapter];
  const names = (first: boolean, env: Record<string, string> = {}) => chosenAdapters(notifiers(first), CONTEXT, env).map(({ name }) => name);
  expect(names(true)).toEqual(['cmux']);
  expect(names(false), 'cmux out of reach').toEqual(['mac']);
  expect(names(true, { AGENT_NOTES_DELIVER: 'mac' })).toEqual(['mac']);
});

test('an adapter that fails is skipped and the rest still deliver', async () => {
  const good = fake('report');
  const bad = fake('cmux', true, true);
  const note: Note = { ...input('a'), id: 'n-0', at: '', prompt: '', reaction: '' };
  expect(await deliverNote(note, [bad.adapter, good.adapter], CONTEXT)).toEqual(['report']);
  expect(good.got).toEqual(['n-0']);
});

test('a sent note lands in reports/notes, and the result says who delivered it and how many went out today', async () => {
  rmSync(FILES.NOTES, { force: true });
  const sent = await sendNotes([input('site:snippet', { prompt: 'Fix it, then stop.' })], [reportAdapter], NOW);
  expect(sent.added.map(({ delivered, canStart }) => ({ delivered, canStart }))).toEqual([{ delivered: ['report'], canStart: true }]);
  expect([sent.today, sent.cap]).toEqual([1, DAILY_CAP]);
  const folder = resolve(FOLDERS.REPORTS, 'notes');
  const [file] = existsSync(folder) ? readdirSync(folder) : [];
  const text = readFileSync(resolve(folder, file ?? ''), 'utf-8');
  expect(text).toContain('**Next:** Do the one small thing.');
  expect(text).toContain('/note start');
  expect(text).toContain('https://example.com/page');
  rmSync(FILES.NOTES, { force: true });
  rmSync(folder, { recursive: true, force: true });
});

test('the notes core never imports an adapter', () => {
  const dir = resolve(import.meta.dir);
  const sources = readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  const core = sources.filter((name) => !['tool.ts', 'command.ts'].includes(name));
  const offenders = core.filter((name) => /from '@\/(cmux|adapters|reports\/notes)/.test(readFileSync(resolve(dir, name), 'utf-8')));
  expect(core.length).toBeGreaterThan(3);
  expect(offenders).toEqual([]);
});
