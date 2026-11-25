import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  CANONICAL,
  importStatement,
  type Importer,
  lineIds,
  parseDate,
  parseImporter,
  parseMoney,
  prove,
  readLines,
  readXlsx
} from './import';
import { Check } from './layout';

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'finances-import-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const write = (root: string, file: string, body: string): string => {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return path;
};

const ACME_BANK: Importer = {
  id: 'acme-bank',
  date: 'Posting Date',
  dateFormat: 'DD/MM/YYYY',
  description: ['Description', 'Reference'],
  debit: 'Withdrawal',
  credit: 'Deposit',
  balance: 'Balance',
  invert: false
};

const PROFILE = `---
name: Acme Sdn. Bhd.
kind: company
fye: 12-31
close: monthly
---

## Accounts

\`\`\`yaml
- { id: acme-main, name: Acme Bank current, institution: acme-bank, type: current, currency: MYR }
- { id: acme-card, name: Acme card, institution: acme-card, type: card, currency: MYR }
\`\`\`
`;

const IMPORTER = `---
institution: acme-bank
format: csv
---

# Acme Bank

## Columns

\`\`\`yaml
date: Posting Date
date_format: DD/MM/YYYY
description: [Description, Reference]
debit: Withdrawal
credit: Deposit
balance: Balance
\`\`\`
`;

const OCTOBER = `Acme Bank Berhad
Account statement,,,,,
Posting Date,Description,Reference,Withdrawal,Deposit,Balance
31/10/2026,Transfer from client,INV-7,,"5,000.00","6,150.00"
15/10/2026,Hosting,,50.00,,"1,150.00"
02/10/2026,Coffee,,,,
01/10/2026,Coffee,,"1,000.00",,"1,200.00"
,Total,,"1,050.00","5,000.00",
`;

const home = (): string => {
  const dir = scratch();
  write(dir, 'entities/acme.md', PROFILE);
  write(dir, 'importers/acme-bank.md', IMPORTER);
  return dir;
};

describe('parseMoney', () => {
  test('reads the ways banks write an amount', () => {
    expect(parseMoney('1,234.50')).toBe(1234.5);
    expect(parseMoney('(12.00)')).toBe(-12);
    expect(parseMoney('12.00-')).toBe(-12);
    expect(parseMoney('RM 5.00 DR')).toBe(-5);
    expect(parseMoney('5.00 CR')).toBe(5);
    expect(parseMoney('-7')).toBe(-7);
    expect(parseMoney('MYR -12.34')).toBe(-12.34);
    expect(parseMoney('RM-12.34')).toBe(-12.34);
    expect(parseMoney(' ')).toBeNull();
  });

  test('refuses a cell that is not an amount instead of reading it as 0', () => {
    expect(() => parseMoney('pending')).toThrow('not an amount');
  });
});

describe('parseDate', () => {
  test("reads the importer's format, ignoring a time after the date", () => {
    expect(parseDate('05/10/2026', 'DD/MM/YYYY')).toBe('2026-10-05');
    expect(parseDate('5 Oct 2026', 'D MMM YYYY')).toBe('2026-10-05');
    expect(parseDate('05-October-26', 'DD-MMM-YY')).toBe('2026-10-05');
    expect(parseDate('2026-10-05 13:45', 'YYYY-MM-DD')).toBe('2026-10-05');
    expect(parseDate('45658', 'DD/MM/YYYY')).toBe('2025-01-01');
  });

  test('refuses a date that does not exist or does not match', () => {
    expect(() => parseDate('31/02/2026', 'DD/MM/YYYY')).toThrow('not a real date');
    expect(() => parseDate('2026/10/05', 'DD/MM/YYYY')).toThrow('does not match');
  });
});

describe('parseImporter', () => {
  test('reads the column map under ## Columns', () => {
    expect(parseImporter('acme-bank', IMPORTER)).toEqual(ACME_BANK);
  });

  test('names what a column map is missing', () => {
    expect(() =>
      parseImporter('x', '## Columns\n\n```yaml\ndate: Date\ndate_format: YYYY-MM-DD\ndescription: Memo\n```\n')
    ).toThrow('amount, or debit and credit');
  });
});

describe('readLines', () => {
  test('skips the preamble, puts the lines oldest first, and drops rows with no date', () => {
    const lines = readLines(
      OCTOBER.split('\n').map((line) =>
        line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.replaceAll('"', ''))
      ),
      ACME_BANK
    );
    expect(lines.map((line) => [line.date, line.amount, line.raw])).toEqual([
      ['2026-10-01', -1000, 'Coffee'],
      ['2026-10-02', 0, 'Coffee'],
      ['2026-10-15', -50, 'Hosting'],
      ['2026-10-31', 5000, 'Transfer from client INV-7']
    ]);
  });

  test("turns a card's charges and the balance owed into money out when the importer inverts them", () => {
    const card = readLines(
      [
        ['date', 'description', 'amount', 'balance'],
        ['2026-10-03', 'Shop', '20.00', '120.00'],
        ['2026-10-09', 'Payment', '-120.00', '0.00']
      ],
      { ...CANONICAL, invert: true }
    );
    expect(card.map((line) => [line.amount, line.balance])).toEqual([
      [-20, -120],
      [120, -0]
    ]);
    expect(prove(card, { opening: null, closing: null }).check).toBe(Check.Checked);
  });

  test("turns a card's charges into money out when the importer inverts them", () => {
    const rows = [
      ['date', 'description', 'amount'],
      ['2026-10-03', 'Shop', '20.00']
    ];
    expect(readLines(rows, { ...CANONICAL, balance: undefined, invert: true })[0]?.amount).toBe(-20);
  });

  test('says which columns it could not find', () => {
    expect(() => readLines([['Date', 'Memo']], ACME_BANK)).toThrow('Posting Date');
  });
});

describe('prove', () => {
  const line = (amount: number, balance: number | null) => ({ date: '2026-10-01', amount, raw: 'x', balance });

  test('works out the opening to the cent, never a float remainder', () => {
    expect(prove([line(-1000, 1200)], { opening: null, closing: null }).opening).toBe(2200);
    expect(prove([line(-0.1, 235.03 - 0.1)], { opening: null, closing: null }).opening).toBe(235.03);
  });

  test('checks every running balance and the closing', () => {
    expect(prove([line(-10, 90), line(5, 95)], { opening: null, closing: null })).toEqual({
      check: Check.Checked,
      opening: 100,
      closing: 95
    });
  });

  test('stops at the first balance that does not follow', () => {
    expect(() => prove([line(-10, 90), line(5, 96)], { opening: null, closing: null })).toThrow('line 2');
  });

  test('checks the printed opening and closing when there is no balance column', () => {
    expect(prove([line(-10, null), line(5, null)], { opening: 100, closing: 95 }).check).toBe(Check.Checked);
    expect(() => prove([line(-10, null)], { opening: 100, closing: 95 })).toThrow('does not make the closing');
  });

  test('a statement with no balances at all is unchecked, never trusted', () => {
    expect(prove([line(-10, null)], { opening: null, closing: null }).check).toBe(Check.Unchecked);
  });
});

describe('lineIds', () => {
  test('keeps two identical charges apart and gives an overlapping export the same ids', () => {
    const lines = [
      { date: '2026-10-01', amount: -5, raw: 'Coffee', balance: null },
      { date: '2026-10-01', amount: -5, raw: 'Coffee', balance: null }
    ];
    const ids = lineIds('acme-main', lines);
    expect(new Set(ids).size).toBe(2);
    expect(lineIds('acme-main', lines)).toEqual(ids);
    expect(lineIds('acme-card', lines)).not.toEqual(ids);
  });
});

describe('importStatement', () => {
  test('files the original, appends its lines and the statement, and marks the month in for the books', () => {
    const dir = home();
    const file = write(dir, 'data/inbox/october.csv', OCTOBER);
    const report = importStatement({ dir, file, account: 'acme-main' });
    expect(report).toMatchObject({
      entity: 'acme',
      from: '2026-10-01',
      to: '2026-10-31',
      check: Check.Checked,
      opening: 2200,
      closing: 6150,
      added: 4
    });
    expect(report.filed).toBe('data/originals/acme/2026-10/2026-10-31 acme-main statement.csv');
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(join(dir, report.filed ?? ''), 'utf8')).toBe(OCTOBER);
    const transactions = readFileSync(join(dir, 'data/transactions/acme/2026.csv'), 'utf8').trim().split('\n');
    expect(transactions).toHaveLength(5);
    expect(transactions[4]).toContain(',2026-10-31,acme-main,5000,MYR,6150,Transfer from client INV-7,');
    expect(readFileSync(join(dir, 'data/statements.csv'), 'utf8')).toContain(
      'acme-main,2026-10-01,2026-10-31,2200,6150,MYR,,,checked,'
    );
    expect(readFileSync(join(dir, 'data/ledger/acme/2026.csv'), 'utf8')).toContain(
      '2026-10-31,statement,Acme Bank current,,MYR,6150,,0,2026-10-01 to 2026-10-31,acme-main,'
    );
  });

  test('the same file twice adds nothing, and an overlapping export adds only its new lines', () => {
    const dir = home();
    importStatement({ dir, file: write(dir, 'data/inbox/a.csv', OCTOBER), account: 'acme-main' });
    const again = importStatement({ dir, file: write(dir, 'data/inbox/b.csv', OCTOBER), account: 'acme-main' });
    expect(again).toMatchObject({ alreadyImported: true, added: 0, filed: null });
    const reexport = importStatement({
      dir,
      file: write(dir, 'data/inbox/again.csv', OCTOBER.replace('Account statement', 'Exported 2026-11-25 09:14')),
      account: 'acme-main'
    });
    expect(reexport).toMatchObject({ alreadyImported: true, added: 0, filed: null });
    const longer = OCTOBER.replace(
      'Posting Date,Description,Reference,Withdrawal,Deposit,Balance\n',
      'Posting Date,Description,Reference,Withdrawal,Deposit,Balance\n02/11/2026,Rent,,100.00,,"6,050.00"\n'
    );
    const overlap = importStatement({ dir, file: write(dir, 'data/inbox/c.csv', longer), account: 'acme-main' });
    expect(overlap).toMatchObject({ added: 1, repeated: 4, to: '2026-11-02' });
    expect(readFileSync(join(dir, 'data/transactions/acme/2026.csv'), 'utf8').trim().split('\n')).toHaveLength(6);
  });

  test('an original that cannot be filed leaves no statement, so the retry imports it', () => {
    const dir = home();
    write(dir, 'data/originals/acme', 'a file where the folder goes');
    const file = write(dir, 'data/inbox/october.csv', OCTOBER);
    expect(() => importStatement({ dir, file, account: 'acme-main' })).toThrow();
    expect(existsSync(join(dir, 'data/statements.csv'))).toBe(false);
    rmSync(join(dir, 'data/originals/acme'));
    expect(importStatement({ dir, file, account: 'acme-main' })).toMatchObject({ alreadyImported: false, added: 4 });
  });

  test('each account imports in its own currency, whatever the entity pins', () => {
    const dir = home();
    write(
      dir,
      'entities/acme.md',
      PROFILE.replace(
        'currency: MYR }\n- { id: acme-card',
        'currency: MYR }\n- { id: acme-gbp, name: Acme pounds, currency: GBP }\n- { id: acme-card'
      )
    );
    importStatement({
      dir,
      account: 'acme-gbp',
      file: write(dir, 'data/inbox/gbp.csv', 'date,description,amount,balance\n2026-10-02,Hosting,-12.50,87.50\n')
    });
    const rows = readFileSync(join(dir, 'data/transactions/acme/2026.csv'), 'utf8').trim().split('\n');
    expect(rows[1]?.split(',').slice(2, 5)).toEqual(['acme-gbp', '-12.5', 'GBP']);
  });

  test('a statement with balances replaces an export of the same period that had none', () => {
    const dir = home();
    const period = { from: '2026-10-01', to: '2026-10-31' };
    const csv = (body: string, name: string) =>
      write(dir, `data/inbox/${name}.csv`, `date,description,amount,balance\n${body}`);
    const first = importStatement({
      dir,
      file: csv('2026-10-05,SHOP A,-10,\n', 'export'),
      account: 'acme-main',
      ...period
    });
    expect(first.check).toBe(Check.Unchecked);
    const proven = importStatement({
      dir,
      file: csv('2026-10-05,SHOP A KUALA LUMPUR,-10,\n', 'statement'),
      account: 'acme-main',
      ...period,
      opening: 100,
      closing: 90
    });
    expect(proven).toMatchObject({ check: Check.Checked, alreadyImported: false, added: 1, replaced: first.filed });
    const statements = readFileSync(join(dir, 'data/statements.csv'), 'utf8').trim().split('\n');
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain('acme-main,2026-10-01,2026-10-31,100,90,MYR,,,checked,');
    const transactions = readFileSync(join(dir, 'data/transactions/acme/2026.csv'), 'utf8').trim().split('\n');
    expect(transactions.slice(1).map((row) => row.split(',')[6])).toEqual(['SHOP A KUALA LUMPUR']);
    const ledger = readFileSync(join(dir, 'data/ledger/acme/2026.csv'), 'utf8').trim().split('\n');
    expect(ledger.slice(1).filter((row) => row.includes(',statement,'))).toHaveLength(1);
    expect(ledger.at(-1)).toContain(',90,');
    expect(
      importStatement({ dir, file: csv('2026-10-05,SHOP A,-10,\n', 'export-again'), account: 'acme-main', ...period })
    ).toMatchObject({ alreadyImported: true, added: 0 });
  });

  test('a statement that does not add up is refused and nothing is written', () => {
    const dir = home();
    const file = write(dir, 'data/inbox/broken.csv', OCTOBER.replace('"6,150.00"', '"6,151.00"'));
    expect(() => importStatement({ dir, file, account: 'acme-main' })).toThrow('does not follow');
    expect(existsSync(file)).toBe(true);
    expect(existsSync(join(dir, 'data/statements.csv'))).toBe(false);
    expect(existsSync(join(dir, 'data/transactions'))).toBe(false);
  });

  test('a dry run reports what would happen and writes nothing', () => {
    const dir = home();
    const file = write(dir, 'data/inbox/october.csv', OCTOBER);
    expect(importStatement({ dir, file, account: 'acme-main', dryRun: true })).toMatchObject({
      added: 4,
      dryRun: true
    });
    expect(existsSync(file)).toBe(true);
    expect(existsSync(join(dir, 'data/statements.csv'))).toBe(false);
  });

  test('a PDF is filed while its staged lines are imported, proved by its printed balances', () => {
    const dir = home();
    const pdf = write(dir, 'data/inbox/card.pdf', '%PDF-1.4 card statement');
    const staged = write(
      dir,
      'data/inbox/.staged/card.csv',
      'date,description,amount,balance\n2026-10-03,Shop,-20.00,\n2026-10-09,Payment,20.00,\n'
    );
    const report = importStatement({
      dir,
      file: staged,
      original: pdf,
      account: 'acme-card',
      opening: 0,
      closing: 0,
      due: '2026-11-05',
      amountDue: 0
    });
    expect(report).toMatchObject({
      check: Check.Checked,
      added: 2,
      filed: 'data/originals/acme/2026-10/2026-10-09 acme-card statement.pdf'
    });
    expect(existsSync(pdf)).toBe(false);
    expect(existsSync(staged)).toBe(false);
    expect(readFileSync(join(dir, 'data/statements.csv'), 'utf8')).toContain(
      'acme-card,2026-10-03,2026-10-09,0,0,MYR,2026-11-05,0,checked,'
    );
  });

  test('a file outside the inbox is copied, never moved', () => {
    const dir = home();
    const outside = write(scratch(), 'Downloads/october.csv', OCTOBER);
    importStatement({ dir, file: outside, account: 'acme-main' });
    expect(existsSync(outside)).toBe(true);
  });

  test('an account no profile lists, or one listed twice, stops the run', () => {
    const dir = home();
    expect(() => importStatement({ dir, file: write(dir, 'x.csv', OCTOBER), account: 'nope' })).toThrow(
      'no account nope'
    );
    write(dir, 'entities/acme-labs.md', PROFILE.replace('Acme Sdn. Bhd.', 'Acme Labs'));
    expect(() => importStatement({ dir, file: write(dir, 'y.csv', OCTOBER), account: 'acme-main' })).toThrow(
      'unique across entities'
    );
  });
});

describe('readXlsx', () => {
  const hasZip = Bun.spawnSync(['which', 'zip']).exitCode === 0;

  test.skipIf(!hasZip)('reads shared strings, inline strings, numbers and gaps', () => {
    const dir = scratch();
    write(
      dir,
      'book/xl/sharedStrings.xml',
      '<sst><si><t>Posting Date</t></si><si><t>Description</t></si><si><r><t>Tea &amp; </t></r><r><t>cake</t></r></si></sst>'
    );
    write(
      dir,
      'book/xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Balance</t></is></c></row><row r="2"><c r="A2"><v>45658</v></c><c r="B2" t="s"><v>2</v></c><c r="D2"><v>12.5</v></c></row></sheetData></worksheet>'
    );
    const zipped = Bun.spawnSync(['zip', '-qr', join(dir, 'book.xlsx'), 'xl'], { cwd: join(dir, 'book') });
    expect(zipped.exitCode).toBe(0);
    expect(readXlsx(join(dir, 'book.xlsx'))).toEqual([
      ['Posting Date', 'Description', '', 'Balance'],
      ['45658', 'Tea & cake', '', '12.5']
    ]);
  });

  test.skipIf(!hasZip)('a cell with no position follows the one before it instead of landing in column A', () => {
    const dir = scratch();
    write(
      dir,
      'book/xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="1"><c t="inlineStr"><is><t>Date</t></is></c><c t="inlineStr"><is><t>Amount</t></is></c><c r="D1" t="inlineStr"><is><t>Note</t></is></c></row></sheetData></worksheet>'
    );
    expect(Bun.spawnSync(['zip', '-qr', join(dir, 'book.xlsx'), 'xl'], { cwd: join(dir, 'book') }).exitCode).toBe(0);
    expect(readXlsx(join(dir, 'book.xlsx'))).toEqual([['Date', 'Amount', '', 'Note']]);
  });

  test.skipIf(!hasZip)('a cell with no attributes at all keeps its value', () => {
    const dir = scratch();
    write(
      dir,
      'book/xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c><v>2</v></c><c r="C1"><v>3</v></c></row></sheetData></worksheet>'
    );
    expect(Bun.spawnSync(['zip', '-qr', join(dir, 'book.xlsx'), 'xl'], { cwd: join(dir, 'book') }).exitCode).toBe(0);
    expect(readXlsx(join(dir, 'book.xlsx'))).toEqual([['1', '2', '3']]);
  });
});
