import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';

const HOME = mkdtempSync(resolve(tmpdir(), 'feedback-keys-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

const LOG = resolve(HOME, 'knowledge', 'raw', 'user', 'feedback.md');
const SESSION = '11111111-aaaa-bbbb-cccc-000000000001';
const OTHER = '22222222-aaaa-bbbb-cccc-000000000002';
const QUOTE = 'No, search by name, not by email.';

let capture: typeof import('@/knowledge/capture').capture;

beforeAll(async () => {
  mkdirSync(resolve(HOME, RUNTIME_DIR), { recursive: true });
  writeFileSync(resolve(HOME, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
  ({ capture } = await import('@/knowledge/capture'));
});

beforeEach(() => rmSync(LOG, { force: true }));

afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  if (PRELOAD_HOME === undefined) delete process.env.AGENT_HOME;
  else process.env.AGENT_HOME = PRELOAD_HOME;
});

const record = (opts: { session?: string; date?: string; quote?: string; text?: string }) =>
  capture({ kind: 'feedback', label: 'correction', text: opts.text ?? 'Looking for a duplicate account.', ...opts });

const entries = (): number => (readFileSync(LOG, 'utf-8').match(/^## /gm) ?? []).length;

describe('keyed feedback entries', () => {
  test('an extracted correction is dated by its session and carries the quote and its key', async () => {
    const result = await record({ session: SESSION, date: '2026-03-02', quote: QUOTE });
    expect(result.duplicate).toBe(false);
    const log = readFileSync(LOG, 'utf-8');
    expect(log).toMatch(new RegExp(`^## 2026-03-02 — correction \\[${SESSION}:[0-9a-f]{16}\\]$`, 'm'));
    expect(log).toContain(`> ${QUOTE}\n\nLooking for a duplicate account.`);
  });

  test('the same chunk compiled again appends nothing', async () => {
    await record({ session: SESSION, date: '2026-03-02', quote: QUOTE });
    const again = await record({
      session: SESSION,
      date: '2026-03-02',
      quote: QUOTE,
      text: 'A second reading of the scope.'
    });
    expect(again).toMatchObject({ duplicate: true, bytes: 0 });
    expect(entries()).toBe(1);
  });

  test('the same words in another session are a second statement', async () => {
    await record({ session: SESSION, date: '2026-03-02', quote: 'no' });
    expect((await record({ session: OTHER, date: '2026-03-02', quote: 'no' })).duplicate).toBe(false);
    expect(entries()).toBe(2);
  });

  test('a statement written live is matched to its extracted copy by words and day, whatever its punctuation', async () => {
    await record({ date: '2026-03-02', quote: 'no,  search by NAME — not by email' });
    expect((await record({ session: SESSION, date: '2026-03-02', quote: QUOTE })).duplicate).toBe(true);
    expect((await record({ session: SESSION, date: '2026-03-09', quote: QUOTE })).duplicate).toBe(false);
    expect(entries()).toBe(2);
  });

  test('an entry without a quote keeps the old form and is never deduplicated', async () => {
    await capture({ kind: 'feedback', text: 'Always preview a card.', label: 'rule' });
    await capture({ kind: 'feedback', text: 'Always preview a card.', label: 'rule' });
    expect(entries()).toBe(2);
    expect(readFileSync(LOG, 'utf-8')).toMatch(/^## \d{4}-\d{2}-\d{2}T[^\n]* — rule$/m);
  });

  test('a session or date without a quote, or one that is malformed, is refused', async () => {
    expect(record({ session: SESSION })).rejects.toThrow('key a quote');
    expect(record({ session: 'not a session', quote: QUOTE })).rejects.toThrow('Not a session id');
    expect(record({ date: 'March 2', quote: QUOTE })).rejects.toThrow('Not a YYYY-MM-DD date');
  });
});
