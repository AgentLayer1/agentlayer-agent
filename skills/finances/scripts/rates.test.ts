import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildFinance, loadFinance } from './build';
import { readRates, updateRates } from './rates';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'finances-rates-'));
  dirs.push(dir);
  const write = (file: string, body: string): void => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), body);
  };
  write(
    'entities/ada.md',
    '---\nname: Ada\nkind: individual\ncurrency: MYR\n---\n\n## Accounts\n\n```yaml\n- { id: ada-main, name: Main }\n- { id: ada-usd, name: Dollars, currency: USD }\n- { id: ada-gbp, name: Pounds, currency: GBP }\n```\n'
  );
  write('data/statements.csv', 'account,period_start,period_end\nada-main,2026-09-01,2026-09-30\n');
  return dir;
};

const rows = (quote: string) => [
  { date: '2026-09-01', base: 'USD', quote, rate: quote === 'MYR' ? 4.07 : 0.74 },
  { date: '2026-10-01', base: 'USD', quote, rate: quote === 'MYR' ? 4.08 : 0.75 },
  { date: '2026-11-01', base: 'USD', quote, rate: quote === 'MYR' ? 4.1 : 0.76 }
];

describe('updateRates', () => {
  test('fetches every month from the first statement for each currency but the dollar, and only what is missing', async () => {
    const dir = project();
    const asked: string[] = [];
    const report = await updateRates(dir, '2026-11-25', async (url) => {
      asked.push(url);
      return rows((new URL(url).searchParams.get('quotes') ?? '').toUpperCase());
    });
    expect(report).toEqual({ currencies: ['GBP', 'MYR'], added: 6, missing: [] });
    expect(asked.every((url) => url.includes('from=2026-09-01') && url.includes('base=usd'))).toBe(true);
    expect(readRates(dir)['2026-10']).toEqual({ GBP: 0.75, MYR: 4.08 });
    asked.length = 0;
    await updateRates(dir, '2026-11-25', async (url) => {
      asked.push(url);
      return rows((new URL(url).searchParams.get('quotes') ?? '').toUpperCase());
    });
    expect(asked.every((url) => url.includes('from=2026-11-01'))).toBe(true);
  });

  test('offline, or for a currency the source refuses, keeps what was saved and says what is missing', async () => {
    const dir = project();
    writeFileSync(join(dir, 'data/rates.csv'), 'month,currency,per_usd,source\n2026-09,MYR,4.07,frankfurter\n');
    const report = await updateRates(dir, '2026-11-25', async () => {
      throw new Error('fetch failed');
    });
    expect(report.added).toBe(0);
    expect(report.missing).toEqual(['GBP: fetch failed', 'MYR: fetch failed']);
    expect(readFileSync(join(dir, 'data/rates.csv'), 'utf8')).toContain('2026-09,MYR,4.07');
  });

  test('the build carries the saved rates to the page', () => {
    const dir = project();
    writeFileSync(join(dir, 'data/rates.csv'), 'month,currency,per_usd,source\n2026-09,MYR,4.07,frankfurter\n');
    expect(buildFinance(loadFinance(dir, '2026-11-25')).rates).toEqual({ '2026-09': { MYR: 4.07 } });
  });
});
