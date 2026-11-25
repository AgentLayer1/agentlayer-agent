import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { hashBuffer } from '@/knowledge/utils';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';

const HOME = mkdtempSync(resolve(tmpdir(), 'capture-finance-'));
const DOWNLOADS = mkdtempSync(resolve(tmpdir(), 'capture-finance-downloads-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

const INBOX = resolve(HOME, 'projects', 'finances', 'data', 'inbox');
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28]);

let capture: typeof import('@/knowledge/capture').capture;

beforeAll(async () => {
  mkdirSync(resolve(HOME, RUNTIME_DIR), { recursive: true });
  writeFileSync(resolve(HOME, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
  ({ capture } = await import('@/knowledge/capture'));
});

afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  rmSync(DOWNLOADS, { recursive: true, force: true });
  if (PRELOAD_HOME === undefined) delete process.env.AGENT_HOME;
  else process.env.AGENT_HOME = PRELOAD_HOME;
});

const download = (name: string, bytes: Buffer | string): string => {
  const path = resolve(DOWNLOADS, name);
  writeFileSync(path, bytes);
  return path;
};

describe('capture kind finance', () => {
  test('copies a binary statement into the finances inbox byte for byte, and leaves the download where it was', async () => {
    const source = download('october.pdf', PDF);
    const result = await capture({ kind: 'finance', file: source });
    expect(result).toMatchObject({
      kind: 'finance',
      relPath: 'projects/finances/data/inbox/october.pdf',
      duplicate: false
    });
    expect(readFileSync(resolve(INBOX, 'october.pdf')).equals(PDF)).toBe(true);
    expect(existsSync(source)).toBe(true);
  });

  test('the same file again is a duplicate, and a different file with the same name gets its own', async () => {
    expect((await capture({ kind: 'finance', file: download('october.pdf', PDF) })).duplicate).toBe(true);
    const other = await capture({ kind: 'finance', file: download('october.pdf', 'date,description,amount\n') });
    expect(other.duplicate).toBe(false);
    expect(other.relPath).toMatch(/^projects\/finances\/data\/inbox\/october-[0-9a-f]{6}\.pdf$/);
  });

  test('a file already imported is a duplicate, by the hash the importer records', async () => {
    const bytes = 'date,description,amount\n2026-10-01,x,-1\n';
    writeFileSync(
      resolve(HOME, 'projects', 'finances', 'data', 'statements.csv'),
      `account,period_start,period_end,opening,closing,currency,due_date,amount_due,check,file,sha\nmain,2026-10-01,2026-10-31,,,MYR,,,unchecked,data/originals/x.csv,${hashBuffer(Buffer.from(bytes))}\n`
    );
    const result = await capture({ kind: 'finance', file: download('old.csv', bytes) });
    expect(result).toMatchObject({ duplicate: true, relPath: 'projects/finances/data/statements.csv' });
    expect(existsSync(resolve(INBOX, 'old.csv'))).toBe(false);
  });

  test('takes a file only', async () => {
    await expect(capture({ kind: 'finance', text: 'October statement' })).rejects.toThrow('takes a file');
  });
});
