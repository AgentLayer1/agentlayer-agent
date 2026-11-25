import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildFinance, loadFinance } from './build';
import { importStatement } from './import';
import { addReceipt, linkReceipt, loadReceipts, matchReceipts } from './receipts';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const TODAY = '2026-11-02';

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'finances-receipts-'));
  dirs.push(dir);
  const write = (file: string, body: string): string => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), body);
    return join(dir, file);
  };
  write(
    'entities/ada.md',
    '---\nname: Personal\nkind: individual\nclose: none\n---\n\n## Accounts\n\n```yaml\n- { id: ada-main, name: Ada current }\n```\n'
  );
  importStatement({
    dir,
    account: 'ada-main',
    file: write(
      'data/inbox/s.csv',
      'date,description,amount,balance\n2026-10-03,ACME GROCER SETIA,-82.40,917.60\n2026-10-04,CAFE ONE,-12.00,905.60\n2026-10-05,CAFE ONE,-12.00,893.60\n2026-10-20,CITY PHARMACY,-30.00,863.60\n'
    )
  });
  return { dir, write };
};

const lineOn = (dir: string, date: string): string =>
  buildFinance(loadFinance(dir, TODAY)).lines.find((line) => line.date === date)?.id ?? '';

describe('receipts', () => {
  test('a receipt is filed, recorded once, and matched to the one line it fits', () => {
    const { dir, write } = project();
    const file = write('data/inbox/receipt.jpg', 'jpeg bytes');
    const first = addReceipt(dir, {
      file,
      date: '2026-10-02',
      merchant: 'Acme Grocer',
      amount: 82.4,
      currency: 'MYR',
      items: 'rice, milk',
      entity: 'ada'
    });
    expect(first.added).toBe(true);
    expect(first.receipt.file).toBe('data/receipts/ada/2026-10/2026-10-02 acme-grocer 82.4 MYR.jpg');
    expect(existsSync(file)).toBe(false);
    const again = write('data/inbox/again.jpg', 'jpeg bytes');
    expect(
      addReceipt(dir, {
        file: again,
        date: '2026-10-02',
        merchant: 'Acme Grocer',
        amount: 82.4,
        currency: 'MYR',
        entity: 'ada'
      }).added
    ).toBe(false);
    expect(matchReceipts(dir, TODAY)).toEqual({
      matched: [{ receipt: first.receipt.id, line: lineOn(dir, '2026-10-03') }],
      ambiguous: [],
      unmatched: []
    });
    expect(buildFinance(loadFinance(dir, TODAY)).lines.find((line) => line.date === '2026-10-03')?.receipt).toBe(
      first.receipt.file
    );
  });

  test('two lines that fit, or none, are left for the agent to ask about', () => {
    const { dir, write } = project();
    const cafe = addReceipt(dir, {
      file: write('a.pdf', 'cafe'),
      date: '2026-10-04',
      merchant: 'Cafe One',
      amount: 12,
      currency: 'MYR',
      entity: 'ada'
    });
    const wrongAmount = addReceipt(dir, {
      file: write('b.pdf', 'pharmacy'),
      date: '2026-10-20',
      merchant: 'City Pharmacy',
      amount: 31,
      currency: 'MYR',
      entity: 'ada'
    });
    const report = matchReceipts(dir, TODAY);
    expect(report.matched).toEqual([]);
    expect(report.ambiguous).toEqual([
      { receipt: cafe.receipt.id, lines: [lineOn(dir, '2026-10-04'), lineOn(dir, '2026-10-05')] }
    ]);
    expect(report.unmatched).toEqual([wrongAmount.receipt.id]);
    expect(existsSync(join(dir, 'a.pdf'))).toBe(true);
  });

  test('a match the operator confirmed is recorded, and an unknown receipt or line refused', () => {
    const { dir, write } = project();
    const cafe = addReceipt(dir, {
      file: write('a.pdf', 'cafe'),
      date: '2026-10-04',
      merchant: 'Cafe One',
      amount: 12,
      currency: 'MYR',
      entity: 'ada'
    });
    linkReceipt(dir, cafe.receipt.id, lineOn(dir, '2026-10-05'), TODAY);
    expect(loadReceipts(dir)[0]?.line).toBe(lineOn(dir, '2026-10-05'));
    expect(() => linkReceipt(dir, 'nope', lineOn(dir, '2026-10-05'), TODAY)).toThrow('no receipt nope');
    expect(() => linkReceipt(dir, cafe.receipt.id, 'nope', TODAY)).toThrow('no line nope');
    expect(readFileSync(join(dir, 'data/receipts.csv'), 'utf8').split('\n')[0]).toBe(
      'id,date,merchant,amount,currency,items,entity,file,line'
    );
  });
});
