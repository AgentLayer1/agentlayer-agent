import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  BillState,
  buildFinance,
  Cadence,
  classify,
  classifyAll,
  defaultPayee,
  detectRecurring,
  type FinanceInput,
  Kind,
  loadFinance,
  parseRules,
  type Rule,
  type Statement,
  type Txn
} from './build';
import type { Entity } from './calendar';
import { importStatement } from './import';

const entity = (
  slug: string,
  kind: 'company' | 'individual',
  accounts: { id: string; name: string; type?: string }[],
  extra: Partial<Entity> = {}
): Entity => ({
  slug,
  name: slug,
  kind,
  country: 'my',
  fye: '12-31',
  close: kind === 'company' ? 'monthly' : 'none',
  sme: false,
  resident: null,
  spouseRelief: null,
  childrenUnder18: null,
  startedOn: null,
  bookedThrough: null,
  directorBalance: null,
  directorBalanceOn: null,
  accounts,
  obligations: [],
  ...extra
});

const ENTITIES = [
  entity(
    'acme',
    'company',
    [
      { id: 'acme-main', name: 'Acme current' },
      { id: 'acme-card', name: 'Acme card', type: 'card' }
    ],
    { directorBalance: 5000, directorBalanceOn: '2026-09-30' }
  ),
  entity('ada', 'individual', [{ id: 'ada-main', name: 'Ada current' }])
];

const owner: Record<string, string> = { 'acme-main': 'acme', 'acme-card': 'acme', 'ada-main': 'ada' };
const txn = (id: string, date: string, account: string, amount: number, raw: string): Txn => ({
  id,
  date,
  account,
  entity: owner[account] ?? '',
  amount,
  currency: 'MYR',
  raw
});

const TXNS: Txn[] = [
  txn('s1', '2026-07-05', 'ada-main', -45, 'STREAMCO*884412 KL'),
  txn('s2', '2026-08-05', 'ada-main', -45, 'STREAMCO*884413 KL'),
  txn('s3', '2026-09-05', 'ada-main', -45, 'STREAMCO*884414 KL'),
  txn('s4', '2026-10-06', 'ada-main', -55, 'STREAMCO*884415 KL'),
  txn('d1', '2026-10-10', 'acme-main', -1000, 'TRANSFER TO ADA'),
  txn('d2', '2026-10-11', 'ada-main', 1000, 'TRANSFER FROM ACME'),
  txn('c1', '2026-10-20', 'acme-main', -200, 'CARD PAYMENT'),
  txn('c2', '2026-10-21', 'acme-card', 200, 'PAYMENT RECEIVED'),
  txn('x1', '2026-10-15', 'ada-main', -12, 'CAFE ONE'),
  txn('x2', '2026-10-16', 'ada-main', -12, 'CAFE ONE'),
  txn('f1', '2026-10-25', 'acme-main', -10, 'LATE CHARGE'),
  txn('z1', '2026-10-26', 'ada-main', -250, 'ZAKAT FITRAH'),
  txn('i1', '2026-10-28', 'acme-main', 8000, 'CLIENT ACME LLC INV 12'),
  txn('old', '2025-01-02', 'ada-main', -5, 'ANCIENT')
];

const RULES: Rule[] = [
  { match: '^STREAMCO', payee: 'Streamco' },
  { payee: 'Streamco', category: 'subscriptions' },
  { match: 'ZAKAT', category: 'zakat' },
  { match: 'CAFE', category: 'food' }
];

const statement = (account: string, from: string, to: string, extra: Partial<Statement> = {}): Statement => ({
  account,
  from,
  to,
  opening: null,
  closing: null,
  currency: 'MYR',
  due: null,
  amountDue: null,
  check: 'checked',
  ...extra
});

const STATEMENTS: Statement[] = [
  statement('acme-main', '2026-10-01', '2026-10-31', { opening: 0, closing: 6790 }),
  statement('acme-main', '2026-11-03', '2026-11-30', { opening: 6790, closing: 6790 }),
  statement('acme-card', '2026-10-01', '2026-10-31', { due: '2026-11-25', amountDue: 200, check: 'unchecked' }),
  statement('ada-main', '2026-07-01', '2026-11-30')
];

const INPUT: FinanceInput = {
  today: '2026-11-25',
  entities: ENTITIES,
  txns: TXNS,
  statements: STATEMENTS,
  rules: RULES
};

describe('classify', () => {
  test('renames the payee first, then sets the category from the payee or the description', () => {
    expect(classify(TXNS[0] as Txn, RULES)).toEqual({ payee: 'Streamco', category: 'subscriptions' });
    expect(classify(txn('z', '2026-10-01', 'ada-main', -1, 'ZAKAT'), RULES)).toEqual({
      payee: 'ZAKAT',
      category: 'zakat'
    });
    expect(classify(txn('n', '2026-10-01', 'ada-main', -1, 'SHOP 99'), RULES).category).toBeNull();
  });

  test('a rule limited to an account leaves the others alone', () => {
    const rules: Rule[] = [{ match: 'SHOP', category: 'office', account: 'acme-main' }];
    expect(classify(txn('a', '2026-10-01', 'acme-main', -1, 'SHOP'), rules).category).toBe('office');
    expect(classify(txn('b', '2026-10-01', 'ada-main', -1, 'SHOP'), rules).category).toBeNull();
  });

  test('a default payee drops reference numbers', () => {
    expect(defaultPayee('STREAMCO*884412 KL')).toBe('STREAMCO KL');
  });
});

describe('classifyAll', () => {
  const kinds = Object.fromEntries(classifyAll(TXNS, RULES, ENTITIES).map((line) => [line.id, line.kind]));

  test('money between a company and the operator is a director movement, never spending', () => {
    expect([kinds.d1, kinds.d2]).toEqual([Kind.Director, Kind.Director]);
  });

  test("paying the company's card from its current account is a transfer", () => {
    expect([kinds.c1, kinds.c2]).toEqual([Kind.Transfer, Kind.Transfer]);
  });

  test('zakat is charity, money in is income, the rest is spending', () => {
    expect([kinds.z1, kinds.i1, kinds.x1]).toEqual([Kind.Charity, Kind.Income, Kind.Spend]);
  });

  test('a rule marking a line as a transfer wins over pairing', () => {
    const lines = classifyAll(
      [txn('a', '2026-10-01', 'acme-main', -5, 'MOVE'), txn('b', '2026-10-01', 'ada-main', 5, 'MOVE')],
      [{ match: 'MOVE', category: 'transfer' }],
      ENTITIES
    );
    expect(lines.map((line) => line.kind)).toEqual([Kind.Transfer, Kind.Transfer]);
  });
});

describe('detectRecurring', () => {
  const lines = classifyAll(TXNS, RULES, ENTITIES);

  test('finds a monthly payment, its next date, and that it went up', () => {
    const [bill] = detectRecurring(lines, new Map([['ada-main', '2026-10-31']]));
    expect(bill).toMatchObject({
      payee: 'Streamco',
      cadence: Cadence.Monthly,
      typical: 45,
      last: 55,
      next: '2026-11-06',
      rising: true,
      state: BillState.Upcoming
    });
  });

  test("is missed once the account's statements run past its date without it", () => {
    expect(detectRecurring(lines, new Map([['ada-main', '2026-11-30']]))[0]?.state).toBe(BillState.Missed);
  });

  test('two payments are not a pattern', () => {
    expect(
      detectRecurring(
        lines.filter((line) => line.id !== 's1' && line.id !== 's2'),
        new Map()
      )
    ).toEqual([]);
  });
});

describe('buildFinance', () => {
  const data = buildFinance(INPUT);

  test('shows each account at its latest closing, and which are behind', () => {
    expect(data.accounts.find((account) => account.id === 'acme-main')).toMatchObject({
      balance: 6790,
      asOf: '2026-11-30',
      statements: 2,
      behind: false
    });
    expect(data.accounts.find((account) => account.id === 'acme-card')?.behind).toBe(false);
    expect(
      buildFinance({ ...INPUT, today: '2026-12-05' }).accounts.find((account) => account.id === 'acme-card')?.behind
    ).toBe(true);
  });

  test("runs the director balance on from the profile's figure", () => {
    expect(data.director).toEqual([
      {
        company: 'acme',
        currency: 'MYR',
        opening: 5000,
        openingOn: '2026-09-30',
        balance: 6000,
        movements: [{ date: '2026-10-10', amount: 1000, payee: 'TRANSFER TO ADA' }]
      }
    ]);
  });

  test('a card statement due within a week and not paid after it closed is due, and files once by its label', () => {
    expect(data.dues).toEqual([
      { account: 'acme-card', entity: 'acme', due: '2026-11-25', amount: 200, currency: 'MYR', paid: false }
    ]);
    expect(data.insights.map((insight) => insight.label)).toContain('fin:pay:acme-card:2026-11');
  });

  test('raises the missed and rising bill, the double charge, the new fee and the unproven statement', () => {
    const labels = data.insights.map((insight) => insight.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'fin:missed:streamco:2026-11',
        'fin:rising:streamco:2026-10',
        'fin:dup:x2',
        'fin:fee:late-charge:2026-10',
        'fin:check:acme-card:2026-10',
        'fin:review:2026-10'
      ])
    );
    expect(data.insights.every((insight) => !/\d+\.\d\d|RM/.test(insight.title))).toBe(true);
  });

  test('each check says whether it holds and what breaks it', () => {
    const checks = Object.fromEntries(data.checks.map((check) => [check.id, check]));
    expect(checks.proven).toMatchObject({ ok: false, items: ['acme-card: 2026-10-01 to 2026-10-31'] });
    expect(checks.gaps).toMatchObject({ ok: false, items: ['acme-main: nothing from 2026-11-01 to 2026-11-02'] });
    expect(checks.openings?.ok).toBe(true);
    expect(checks.categories?.ok).toBe(false);
  });

  test('keeps thirteen months of lines for the page', () => {
    expect(data.lines.some((line) => line.date === '2025-01-02')).toBe(false);
    expect(data.lines).toHaveLength(TXNS.length - 1);
  });

  test('is the same every time for the same inputs', () => {
    expect(JSON.stringify(buildFinance(INPUT))).toBe(JSON.stringify(data));
  });
});

describe('fees', () => {
  test('a categorised payment named "fees" is not a bank fee; an uncategorised charge is', () => {
    const data = buildFinance({
      ...INPUT,
      txns: [
        txn('t1', '2026-10-02', 'ada-main', -4200, 'SCHOOL FEES TERM'),
        txn('t2', '2026-10-03', 'ada-main', -15, 'ANNUAL CARD FEE')
      ],
      rules: [{ match: 'SCHOOL', category: 'education' }]
    });
    expect(data.insights.filter((insight) => insight.kind === 'fee').map((insight) => insight.label)).toEqual([
      'fin:fee:annual-card-fee:2026-10'
    ]);
  });
});

describe('parseRules', () => {
  test('reads payees then categories, and a payee rule never sets a category', () => {
    const raw =
      '## Payees\n\n```yaml\n- { match: "^GRAB", payee: Grab, category: ignored }\n```\n\n## Categories\n\n```yaml\n- { payee: Grab, category: transport }\n```\n';
    expect(parseRules(raw)).toEqual([
      { match: '^GRAB', payee: 'Grab' },
      { payee: 'Grab', category: 'transport' }
    ]);
  });

  test('a broken pattern stops the build with the pattern named', () => {
    expect(() => parseRules('## Categories\n\n```yaml\n- { match: "(", category: x }\n```\n')).toThrow(
      '( is not a valid pattern'
    );
  });
});

describe('loadFinance', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  test('reads what the importer wrote, so an imported statement shows on the next build', () => {
    const dir = mkdtempSync(join(tmpdir(), 'finances-build-'));
    dirs.push(dir);
    const write = (file: string, body: string): string => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), body);
      return join(dir, file);
    };
    write(
      'entities/acme.md',
      '---\nname: Acme\nkind: company\nclose: monthly\n---\n\n## Accounts\n\n```yaml\n- { id: acme-main, name: Acme current }\n```\n'
    );
    write('rules.md', '## Categories\n\n```yaml\n- { match: HOSTING, category: software }\n```\n');
    importStatement({
      dir,
      account: 'acme-main',
      file: write(
        'data/inbox/s.csv',
        'date,description,amount,balance\n2026-10-01,HOSTING,-50,950\n2026-10-31,CLIENT,1000,1950\n'
      )
    });
    const data = buildFinance(loadFinance(dir, '2026-11-02'));
    expect(data.accounts[0]).toMatchObject({ id: 'acme-main', balance: 1950, asOf: '2026-10-31', behind: false });
    expect(data.lines.map((line) => [line.category, line.kind])).toEqual([
      ['software', Kind.Spend],
      [null, Kind.Income]
    ]);
  });
});
