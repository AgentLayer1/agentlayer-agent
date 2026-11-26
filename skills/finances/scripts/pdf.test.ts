import { describe, expect, test } from 'bun:test';
import { CANONICAL, prove, readLines } from './import';
import { Check } from './layout';
import { draftLayout, type Layout, parseLayout, readStatement, type StatementRow } from './pdf';

/** A line of a layout-mode statement: text from the left, each figure right-aligned to its column's label end. */
const row = (header: string, start: string, figures: Record<string, string>): string =>
  Object.entries(figures).reduce((line, [label, value]) => {
    const end = header.indexOf(label) + label.length;
    return `${line.padEnd(end - value.length)}${value}`;
  }, start);

const BANK_HEADER = '  Date        Description                     Withdrawal        Deposit          Balance';
const BANK_FEE_HEADER =
  '  Date        Description                     Withdrawal        Deposit      Fee          Balance';

const ACME_BANK = [
  'Acme Bank Berhad                                         Statement of Account',
  '',
  BANK_HEADER,
  row(BANK_HEADER, '              OPENING BALANCE', { Balance: '1,000.00' }),
  row(BANK_HEADER, '  01/10/2026  CARD PURCHASE', { Withdrawal: '45.50', Balance: '954.50' }),
  '              CAFE ONE',
  '              KL',
  row(BANK_HEADER, '  03/10/2026  TRANSFER IN', { Deposit: '2,500.00', Balance: '3,454.50' }),
  '              FROM ADA LIM',
  '  05/10/2026  BILL PAYMENT',
  row(BANK_HEADER, '              POWER CO', { Withdrawal: '120.00', Balance: '3,334.50' }),
  '              CONTINUED ON NEXT PAGE',
  '\fAcme Bank Berhad                                         Statement of Account',
  BANK_FEE_HEADER,
  row(BANK_FEE_HEADER, '  09/10/2026  CARD PURCHASE', { Withdrawal: '15.00', Balance: '3,319.50' }),
  '              BOOKSHOP',
  row(BANK_FEE_HEADER, '  12/10/2026  REMITTANCE OUT', { Withdrawal: '300.00', Fee: '5.00', Balance: '3,014.50' }),
  row(BANK_FEE_HEADER, '              CLOSING BALANCE', { Balance: '3,014.50' })
].join('\n');

const ACME_LAYOUT: Layout = {
  date: 'DD/MM/YYYY',
  debit: 'Withdrawal',
  credit: 'Deposit',
  balance: 'Balance',
  charges: ['Fee'],
  opening: 'OPENING BALANCE',
  closing: 'CLOSING BALANCE',
  end: 'CONTINUED ON NEXT PAGE'
};

const CARD_HEADER =
  '  Date            Description                          Money in        Money out      Balance (USD)';

const NOVA_CARD = [
  'Nova Card                                      Opening balance    $80.5',
  CARD_HEADER,
  row(CARD_HEADER, '  14 Oct 2026     GROCER TWO', { 'Money out': '20.10', 'Balance (USD)': '$40.0' }),
  '                  Ref : 9c1f',
  row(CARD_HEADER, '  13 Oct 2026     DECLINED: GAME STORE', { 'Balance (USD)': '$60.1' }),
  row(CARD_HEADER, '  12 Oct 2026     Top up', { 'Money in': '50.00', 'Balance (USD)': '$60.1' }),
  row(CARD_HEADER, '  02 Oct 2026     NOODLE BAR', { 'Money out': '70.40', 'Balance (USD)': '$10.1' }),
  'Nova Card                                      Closing balance    $40.0'
].join('\n');

const NOVA_LAYOUT: Layout = {
  date: 'DD MMM YYYY',
  debit: 'Money out',
  credit: 'Money in',
  balance: 'Balance \\(USD\\)',
  charges: [],
  opening: 'Opening balance',
  closing: 'Closing balance'
};

const proofOf = (rows: StatementRow[], opening: number | null, closing: number | null) => {
  const csv = [
    ['date', 'description', 'amount', 'balance'],
    ...rows.map((r) => [r.date, r.description, r.amount.toFixed(2), r.balance === null ? '' : r.balance.toFixed(2)])
  ];
  return prove(readLines(csv, CANONICAL), { opening, closing });
};

describe('readStatement', () => {
  test('reads a bank statement across a page break, a column only one page has, and a row that wraps', () => {
    const read = readStatement(ACME_BANK, ACME_LAYOUT);
    expect(read.opening).toBe(1000);
    expect(read.closing).toBe(3014.5);
    expect(read.rows).toEqual([
      { date: '2026-10-01', description: 'CARD PURCHASE · CAFE ONE · KL', amount: -45.5, balance: 954.5 },
      { date: '2026-10-03', description: 'TRANSFER IN · FROM ADA LIM', amount: 2500, balance: 3454.5 },
      { date: '2026-10-05', description: 'BILL PAYMENT POWER CO', amount: -120, balance: 3334.5 },
      { date: '2026-10-09', description: 'CARD PURCHASE · BOOKSHOP', amount: -15, balance: 3319.5 },
      { date: '2026-10-12', description: 'REMITTANCE OUT', amount: -305, balance: 3014.5 }
    ]);
    expect(read.charged).toEqual(['2026-10-12 REMITTANCE OUT']);
    expect(proofOf(read.rows, read.opening, read.closing).check).toBe(Check.Checked);
  });

  test('reads a newest-first card statement with one-decimal dollar balances, and skips a line with no money', () => {
    const read = readStatement(NOVA_CARD, NOVA_LAYOUT);
    expect(read.opening).toBe(80.5);
    expect(read.closing).toBe(40);
    expect(read.rows.map((r) => [r.date, r.amount, r.balance])).toEqual([
      ['2026-10-14', -20.1, 40],
      ['2026-10-12', 50, 60.1],
      ['2026-10-02', -70.4, 10.1]
    ]);
    expect(read.rows[0]?.description).toBe('GROCER TWO · Ref : 9c1f');
    expect(read.skipped).toEqual(['2026-10-13 DECLINED: GAME STORE']);
    expect(proofOf(read.rows, read.opening, read.closing).check).toBe(Check.Checked);
  });

  test('a balance printed once a day leaves the other lines blank, and the day still proves', () => {
    const statement = [
      BANK_HEADER,
      row(BANK_HEADER, '              OPENING BALANCE', { Balance: '500.00' }),
      row(BANK_HEADER, '  20/10/2026  CAFE ONE', { Withdrawal: '10.00' }),
      row(BANK_HEADER, '  20/10/2026  CAFE ONE', { Withdrawal: '5.00', Balance: '485.00' }),
      row(BANK_HEADER, '              CLOSING BALANCE', { Balance: '485.00' })
    ].join('\n');
    const read = readStatement(statement, ACME_LAYOUT);
    expect(read.rows.map((r) => r.balance)).toEqual([null, 485]);
    expect(proofOf(read.rows, read.opening, read.closing).check).toBe(Check.Checked);
  });

  test('a misread column fails the proof instead of passing quietly', () => {
    const swapped = readStatement(ACME_BANK, { ...ACME_LAYOUT, debit: 'Deposit', credit: 'Withdrawal' });
    expect(() => proofOf(swapped.rows, swapped.opening, swapped.closing)).toThrow('does not follow');
  });
});

describe('parseLayout', () => {
  test("reads an importer file's layout block", () => {
    const raw =
      '---\ninstitution: acme-bank\nformat: pdf\n---\n\n## Layout\n\n```yaml\ndate: DD/MM/YYYY\ncolumns: { debit: Withdrawal, credit: Deposit, balance: Balance, charges: [Fee] }\nopening: OPENING BALANCE\nclosing: CLOSING BALANCE\nend: CONTINUED ON NEXT PAGE\n```\n';
    expect(parseLayout('acme-bank', raw)).toEqual(ACME_LAYOUT);
  });

  test('refuses a layout without its date or columns', () => {
    expect(() => parseLayout('acme-bank', '## Layout\n\n```yaml\ndate: DD/MM/YYYY\n```\n')).toThrow(
      'needs date, and columns with debit and credit'
    );
  });
});

describe('draftLayout', () => {
  test('finds the header rows and drafts a layout from their words', () => {
    const draft = draftLayout(ACME_BANK);
    expect(draft.headers).toEqual([BANK_HEADER.trim(), BANK_FEE_HEADER.trim()]);
    expect(draft.layout).toBe(
      'date: "DD/MM/YYYY"\ncolumns:\n  debit: "Withdrawal"\n  credit: "Deposit"\n  balance: "Balance"\nopening: "OPENING BALANCE"\nclosing: "CLOSING BALANCE"'
    );
  });
});
