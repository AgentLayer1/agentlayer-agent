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
  orderRules,
  ruleKey,
  financePlan,
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
import { Check } from './layout';

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
  currency: 'MYR',
  currencyPinned: true,
  fye: '12-31',
  close: kind === 'company' ? 'monthly' : 'none',
  sme: false,
  resident: null,
  spouseRelief: null,
  childrenUnder18: null,
  startedOn: null,
  bookedThrough: null,
  accounts,
  obligations: [],
  ...extra
});

const ENTITIES = [
  entity('acme', 'company', [
    { id: 'acme-main', name: 'Acme current' },
    { id: 'acme-card', name: 'Acme card', type: 'card' }
  ]),
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
  check: Check.Checked,
  ...extra
});

const STATEMENTS: Statement[] = [
  statement('acme-main', '2026-10-01', '2026-10-31', { opening: 0, closing: 6790 }),
  statement('acme-main', '2026-11-03', '2026-11-30', { opening: 6790, closing: 6790 }),
  statement('acme-card', '2026-10-01', '2026-10-31', { due: '2026-11-25', amountDue: 200, check: Check.Unchecked }),
  statement('ada-main', '2026-07-01', '2026-11-30')
];

const INPUT: FinanceInput = {
  today: '2026-11-25',
  entities: ENTITIES,
  txns: TXNS,
  statements: STATEMENTS,
  rules: RULES,
  openings: new Map([['acme', { balance: 5000, on: '2026-09-30' }]])
};

describe('classify', () => {
  test('renames the payee first, then sets the category from the payee or the description', () => {
    expect(classify(TXNS[0] as Txn, RULES)).toMatchObject({ payee: 'Streamco', category: 'subscriptions', for: null });
    expect(classify(txn('z', '2026-10-01', 'ada-main', -1, 'ZAKAT'), RULES)).toMatchObject({
      payee: 'ZAKAT',
      category: 'zakat',
      for: null
    });
    expect(classify(txn('n', '2026-10-01', 'ada-main', -1, 'SHOP 99'), RULES).category).toBeNull();
  });

  test('a rename matches the payee a line would otherwise get, not only the raw text', () => {
    const raw = 'JOMPAY||12345678|87654321|D17|ACME TELCO';
    expect(
      classify(txn('j', '2026-10-01', 'ada-main', -1, raw), [{ match: '^JOMPAY D17 ACME', payee: 'Acme Telco' }]).payee
    ).toBe('Acme Telco');
  });

  test('an approved category keeps its line when a later rename changes the payee', () => {
    const approved: Rule = { payee: 'Example', category: 'housing', confirmed: true };
    const rename: Rule = { match: '^Example$', payee: 'Other' };
    expect(classify(txn('e', '2026-10-01', 'ada-main', -1, 'Example'), orderRules([approved, rename]))).toMatchObject({
      payee: 'Other',
      category: 'housing',
      approved: true
    });
  });

  test('a rule limited to an account leaves the others alone', () => {
    const rules: Rule[] = [{ match: 'SHOP', category: 'office', account: 'acme-main' }];
    expect(classify(txn('a', '2026-10-01', 'acme-main', -1, 'SHOP'), rules).category).toBe('office');
    expect(classify(txn('b', '2026-10-01', 'ada-main', -1, 'SHOP'), rules).category).toBeNull();
  });

  test('a default payee drops reference numbers', () => {
    expect(defaultPayee('STREAMCO*884412 KL')).toBe('STREAMCO KL');
    expect(defaultPayee('DUITNOW TO ACCOUNT||12345678|ACME TRADING|Fund Transfer||')).toBe(
      'DUITNOW TO ACCOUNT ACME TRADING Fund Tra'
    );
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

  test('a categorised purchase and an unrelated credit of the same amount stay spending and income', () => {
    const lines = classifyAll(
      [txn('p', '2026-10-01', 'acme-main', -100, 'GROCER MART'), txn('s', '2026-10-01', 'ada-main', 100, 'SALARY')],
      [
        { match: 'GROCER', category: 'groceries', confirmed: true },
        { match: 'SALARY', category: 'income', confirmed: true }
      ],
      ENTITIES
    );
    expect(lines.map((line) => [line.kind, line.paired])).toEqual([
      [Kind.Spend, false],
      [Kind.Income, false]
    ]);
  });
});

describe('detectRecurring', () => {
  const lines = classifyAll(TXNS, RULES, ENTITIES);

  test('finds a monthly payment, its next date, and that it went up', () => {
    const [bill] = detectRecurring(lines, new Map([['ada-main', [{ from: '2026-07-01', to: '2026-10-31' }]]]));
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
    expect(detectRecurring(lines, new Map([['ada-main', [{ from: '2026-07-01', to: '2026-11-30' }]]]))[0]?.state).toBe(
      BillState.Missed
    );
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

  test('shows each account at its latest closing, and is behind only once a cycle and a few days have passed', () => {
    expect(
      buildFinance({ ...INPUT, today: '2026-12-05' }).accounts.find((account) => account.id === 'acme-card')?.behind
    ).toBe(false);
    expect(data.accounts.find((account) => account.id === 'acme-main')).toMatchObject({
      balance: 6790,
      asOf: '2026-11-30',
      statements: 2,
      behind: false
    });
    expect(data.accounts.find((account) => account.id === 'acme-card')?.behind).toBe(false);
    expect(
      buildFinance({ ...INPUT, today: '2026-12-06' }).accounts.find((account) => account.id === 'acme-card')?.behind
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
        movements: [
          {
            date: '2026-10-10',
            amount: 1000,
            currency: 'MYR',
            payee: 'TRANSFER TO ADA',
            category: null,
            why: 'transfer'
          }
        ]
      }
    ]);
  });

  test('a card statement due within a week and not paid after it closed is due, and files once by its label', () => {
    expect(data.dues).toEqual([
      { account: 'acme-card', entity: 'acme', due: '2026-11-25', amount: 200, currency: 'MYR', paid: false }
    ]);
    expect(data.insights.map((insight) => insight.label)).toContain('fin:pay:acme-card:2026-11-25');
  });

  test('raises the missed and rising bill, the double charge, the new fee and the unproven statement', () => {
    const labels = data.insights.map((insight) => insight.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'fin:missed:ada:streamco:2026-11',
        'fin:rising:ada:streamco:2026-10',
        'fin:dup:x2',
        'fin:fee:acme-main:2026-10',
        'fin:check:acme-card:2026-10',
        'fin:review:2025-01'
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
    expect(checks.currencies?.ok).toBe(true);
    const unpinned = buildFinance({
      ...INPUT,
      entities: [entity('acme', 'company', [], { currencyPinned: false })]
    }).checks.find((check) => check.id === 'currencies');
    expect(unpinned).toMatchObject({ ok: false, items: ['acme: MYR from its country; add currency to its profile'] });
  });

  test('keeps five years of lines for the page', () => {
    expect(data.lines.some((line) => line.date === '2025-01-02')).toBe(true);
    expect(buildFinance({ ...INPUT, today: '2030-02-01' }).lines.some((line) => line.date === '2025-01-02')).toBe(
      false
    );
  });

  test('is the same every time for the same inputs', () => {
    expect(JSON.stringify(buildFinance(INPUT))).toBe(JSON.stringify(data));
  });
});

describe('fees', () => {
  test('a categorised payment named "fees" is not a bank fee; an uncategorised charge is, and an old one is history', () => {
    const data = buildFinance({
      ...INPUT,
      txns: [
        txn('t1', '2026-10-02', 'ada-main', -4200, 'SCHOOL FEES TERM'),
        txn('t2', '2026-10-03', 'ada-main', -15, 'ANNUAL CARD FEE')
      ],
      rules: [{ match: 'SCHOOL', category: 'education' }]
    });
    expect(data.insights.filter((insight) => insight.kind === 'fee').map((insight) => insight.label)).toEqual([
      'fin:fee:ada-main:2026-10'
    ]);
    expect(
      buildFinance({
        ...INPUT,
        today: '2027-01-15',
        txns: [txn('t3', '2026-10-03', 'ada-main', -15, 'ANNUAL CARD FEE')]
      }).insights.filter((insight) => insight.kind === 'fee')
    ).toEqual([]);
  });
});

describe('paid for another entity', () => {
  const rules: Rule[] = [
    ...RULES,
    { match: 'SCHOOL', category: 'education', for: 'ada' },
    { match: 'RESTO', date: '2026-10-14', account: 'acme-card', category: 'dining', for: 'ada' },
    { match: 'CLOUDHOST', category: 'software', for: 'acme' }
  ];
  const txns = [
    ...TXNS,
    txn('p1', '2026-10-02', 'acme-main', -4200, 'SCHOOL FEES TERM 3'),
    txn('p2', '2026-10-14', 'acme-card', -180, 'RESTO X'),
    txn('p3', '2026-10-20', 'acme-card', -90, 'RESTO X'),
    txn('p4', '2026-10-21', 'ada-main', -300, 'CLOUDHOST*1122')
  ];
  const data = buildFinance({ ...INPUT, txns, rules });
  const line = (date: string, payee: string) =>
    data.lines.find((item) => item.date === date && item.payee.startsWith(payee));

  test("a company's payment marked for the operator counts in their spending, under its category, and says who paid", () => {
    expect(line('2026-10-02', 'SCHOOL')).toMatchObject({
      entity: 'ada',
      paidBy: 'acme',
      category: 'education',
      kind: Kind.Spend
    });
    expect(line('2026-10-14', 'RESTO')).toMatchObject({ entity: 'ada', paidBy: 'acme', category: 'dining' });
  });

  test('a rule limited to a day leaves the same payee on other days with the account that paid', () => {
    expect(line('2026-10-20', 'RESTO')).toMatchObject({ entity: 'acme', paidBy: null });
  });

  test("a business cost the operator paid counts as the company's", () => {
    expect(line('2026-10-21', 'CLOUDHOST')).toMatchObject({ entity: 'acme', paidBy: 'ada', category: 'software' });
  });

  test('both move what the operator owes the company, and say why', () => {
    const [acme] = data.director;
    expect(acme?.movements.map((movement) => [movement.date, movement.amount, movement.why])).toEqual([
      ['2026-10-02', 4200, 'paid-for-you'],
      ['2026-10-10', 1000, 'transfer'],
      ['2026-10-14', 180, 'paid-for-you'],
      ['2026-10-21', -300, 'paid-for-company']
    ]);
    expect(acme?.balance).toBe(5000 + 4200 + 1000 + 180 - 300);
  });

  test('money paid for the operator in another currency is listed in it and left out of the balance', () => {
    const usd = { ...txn('u1', '2026-10-05', 'acme-main', -100, 'SCHOOL ONLINE USD'), currency: 'USD' };
    const [acme] = buildFinance({ ...INPUT, txns: [...txns, usd], rules }).director;
    expect(acme?.movements.find((movement) => movement.date === '2026-10-05')).toMatchObject({
      amount: 100,
      currency: 'USD'
    });
    expect(acme).toMatchObject({ currency: 'MYR', balance: 5000 + 4200 + 1000 + 180 - 300 });
  });

  test("a company in another currency keeps its director balance in its own currency, and the home currency is the operator's", () => {
    const usCompany = entity(
      'acme',
      'company',
      [
        { id: 'acme-main', name: 'Acme current' },
        { id: 'acme-card', name: 'Acme card', type: 'card' }
      ],
      { currency: 'USD' }
    );
    const ada = entity('ada', 'individual', [{ id: 'ada-main', name: 'Ada current' }]);
    const data = buildFinance({ ...INPUT, entities: [usCompany, ada], txns, rules });
    expect(data.director[0]).toMatchObject({ currency: 'USD', balance: 5000 });
    expect(data.home).toBe('MYR');
    expect(data.entities.map((entity) => [entity.slug, entity.currency])).toEqual([
      ['acme', 'USD'],
      ['ada', 'MYR']
    ]);
  });

  test('a for naming no entity stops the build', () => {
    expect(() => buildFinance({ ...INPUT, rules: [{ match: 'X', for: 'personal' }] })).toThrow(
      'for: personal is not an entity'
    );
  });
});

describe('a loan seen only from the personal side', () => {
  const loan = txn('l1', '2026-11-03', 'ada-main', 2000, 'DUITNOW LOAN ACME SDN BHD');

  test('a rule marking it director with for the company moves what the operator owes it', () => {
    const data = buildFinance({
      ...INPUT,
      txns: [loan],
      rules: [{ match: 'LOAN ACME', category: 'director', for: 'acme' }]
    });
    expect(data.director[0]?.movements).toEqual([
      {
        date: '2026-11-03',
        amount: 2000,
        currency: 'MYR',
        payee: 'DUITNOW LOAN ACME SDN BHD',
        category: 'director',
        why: 'transfer'
      }
    ]);
    expect(data.lines[0]).toMatchObject({ entity: 'ada', paidBy: null, kind: Kind.Director });
  });

  test('with one company, the rule needs no for', () => {
    const data = buildFinance({ ...INPUT, txns: [loan], rules: [{ match: 'LOAN ACME', category: 'director' }] });
    expect(data.director[0]?.balance).toBe(5000 + 2000);
  });

  test("once the company's side is imported too, the pair counts once, from the company's side", () => {
    const data = buildFinance({
      ...INPUT,
      txns: [txn('c1', '2026-11-02', 'acme-main', -2000, 'LOAN TO ADA'), loan],
      rules: [{ match: 'LOAN', category: 'director', for: 'acme' }]
    });
    expect(data.director[0]?.movements.map((movement) => [movement.date, movement.amount])).toEqual([
      ['2026-11-02', 2000]
    ]);
  });
});

describe('insight labels', () => {
  test('two fees from one new payee in a month, or two unproven statements in a month, are one insight each, and every label is unique', () => {
    const data = buildFinance({
      ...INPUT,
      txns: [
        txn('f1', '2026-10-05', 'acme-main', -10, 'LATE CHARGE'),
        txn('f2', '2026-10-25', 'acme-main', -10, 'LATE CHARGE')
      ],
      statements: [
        statement('acme-card', '2026-10-01', '2026-10-15', { check: Check.Unchecked }),
        statement('acme-card', '2026-10-16', '2026-10-31', { check: Check.Unchecked })
      ]
    });
    const labels = data.insights.map((insight) => insight.label);
    expect(labels.filter((label) => label === 'fin:fee:acme-main:2026-10')).toHaveLength(1);
    expect(labels.filter((label) => label === 'fin:check:acme-card:2026-10')).toHaveLength(1);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(buildFinance(INPUT).insights.map((insight) => insight.label)).size).toBe(
      buildFinance(INPUT).insights.length
    );
  });

  test('two card statements due in one month are two payments', () => {
    const data = buildFinance({
      ...INPUT,
      today: '2026-03-25',
      txns: [],
      statements: [
        statement('acme-card', '2026-01-07', '2026-02-06', { due: '2026-03-03', amountDue: 100 }),
        statement('acme-card', '2026-02-07', '2026-03-06', { due: '2026-03-31', amountDue: 100 })
      ]
    });
    expect(data.insights.filter((insight) => insight.kind === 'pay').map((insight) => insight.label)).toEqual([
      'fin:pay:acme-card:2026-03-03',
      'fin:pay:acme-card:2026-03-31'
    ]);
  });

  test('the categorising task stays on the oldest month with work left, so a new month never closes it', () => {
    const review = (txns: Txn[]) =>
      buildFinance({ ...INPUT, txns }).insights.find((insight) => insight.kind === 'review')?.label;
    const october = txn('o', '2026-10-03', 'ada-main', -5, 'SHOP ONE');
    expect(review([october])).toBe('fin:review:2026-10');
    expect(review([october, txn('d', '2026-12-03', 'ada-main', -5, 'SHOP TWO')])).toBe('fin:review:2026-10');
  });
});

describe('statement coverage', () => {
  test('an export inside a statement is no gap, and the next statement is checked against the one it follows', () => {
    const checks = buildFinance({
      ...INPUT,
      statements: [
        statement('ada-main', '2026-08-01', '2026-08-31', { closing: 50 }),
        statement('ada-main', '2026-08-10', '2026-08-20', { closing: 999 }),
        statement('ada-main', '2026-09-01', '2026-09-30', { opening: 50 })
      ]
    }).checks;
    expect(checks.find((check) => check.id === 'gaps')?.items).toEqual([]);
    expect(checks.find((check) => check.id === 'openings')?.ok).toBe(true);
  });

  test('a bill is not missed in a month no statement covers, even when a later one is imported', () => {
    const lines = classifyAll(TXNS, RULES, ENTITIES);
    const spans = [
      { from: '2026-07-01', to: '2026-10-31' },
      { from: '2026-12-01', to: '2026-12-31' }
    ];
    expect(detectRecurring(lines, new Map([['ada-main', spans]]))[0]?.state).toBe(BillState.Upcoming);
  });
});

describe('learning', () => {
  const suggested: Rule = { payee: 'Streamco', category: 'entertainment' };
  const approved: Rule = { match: 'STREAMCO', category: 'subscriptions', confirmed: true };
  const oneOff: Rule = { id: 's4', category: 'gifts', confirmed: true };

  test('an approved rule wins over a suggestion, and a fix for one line wins over both', () => {
    const lines = classifyAll(TXNS, [suggested, approved, oneOff, { match: '^STREAMCO', payee: 'Streamco' }], ENTITIES);
    const byId = Object.fromEntries(lines.map((line) => [line.id, line]));
    expect(byId.s1).toMatchObject({ category: 'subscriptions', approved: true, rule: ruleKey(approved) });
    expect(byId.s4).toMatchObject({ category: 'gifts', approved: true, rule: ruleKey(oneOff), pinned: true });
    expect(byId.s1?.pinned).toBe(false);
  });

  test('a line a suggestion categorised is suggested, not approved', () => {
    const [line] = classifyAll([TXNS[0] as Txn], [{ match: '^STREAMCO', payee: 'Streamco' }, suggested], ENTITIES);
    expect(line).toMatchObject({ category: 'entertainment', approved: false, rule: ruleKey(suggested) });
  });

  test('orders fixes for one line, then approved rules, then suggestions, keeping file order within each', () => {
    expect(orderRules([suggested, approved, oneOff])).toEqual([oneOff, approved, suggested]);
  });

  test('the page gets each category rule with how many lines it covers, and the approval counts', () => {
    const data = buildFinance({ ...INPUT, rules: [...RULES, approved], categories: ['groceries'] });
    expect(data.rules.find((rule) => rule.key === ruleKey(approved))).toMatchObject({ confirmed: true, lines: 4 });
    expect(data.categories.slice(0, 3)).toEqual(['groceries', 'subscriptions', 'zakat']);
    expect(data.approval).toEqual({ approved: 4, suggested: 3, uncategorised: 3 });
    expect(data.lines.find((line) => line.id === 's1')).toMatchObject({ approved: true, pinned: false });
  });
});

describe('parseRules', () => {
  test('reads payees then categories, and a payee rule never sets a category or whose expense it is', () => {
    const raw =
      '# Rules\n\n## How I categorise\n\n- Grab rides are transport.\n\n## Learned\n\n### Payees\n\n```yaml\n- { match: "^GRAB", payee: Grab, category: ignored, for: ignored }\n```\n\n### Categories\n\n```yaml\n- { payee: Grab, category: transport }\n```\n';
    expect(parseRules(raw)).toEqual([
      { match: '^GRAB', payee: 'Grab' },
      { payee: 'Grab', category: 'transport' }
    ]);
  });

  test('a broken pattern stops the build with the pattern named', () => {
    expect(() => parseRules('## Learned\n\n### Categories\n\n```yaml\n- { match: "(", category: x }\n```\n')).toThrow(
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
    write('RULES.md', '## Learned\n\n### Categories\n\n```yaml\n- { match: HOSTING, category: software }\n```\n');
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

  test("reads each company's director balance from data/, the latest the books stated", () => {
    const dir = mkdtempSync(join(tmpdir(), 'finances-build-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'entities'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'entities/acme.md'), '---\nname: Acme\nkind: company\nclose: none\n---\n');
    writeFileSync(
      join(dir, 'data/director.csv'),
      'company,balance,on,source\nacme,7000,2026-09-30,books-q3.xlsx\nacme,5000,2026-06-30,books-q2.xlsx\n'
    );
    expect(loadFinance(dir, '2026-11-02').openings?.get('acme')).toEqual({ balance: 7000, on: '2026-09-30' });
    expect(buildFinance(loadFinance(dir, '2026-11-02')).director[0]).toMatchObject({ opening: 7000, balance: 7000 });
  });
});

describe('financePlan', () => {
  const insights = buildFinance(INPUT).insights;

  test('files each insight no task carries yet, labelled to be found again, with payments first', () => {
    const plan = financePlan(insights, [{ id: 'fp-001', label: 'fin:dup:x2', status: 'open' }]);
    expect(plan.missing.map((task) => task.label)).not.toContain('fin:dup:x2');
    expect(plan.missing.find((task) => task.kind === 'pay')).toMatchObject({
      priority: 'P1',
      due: '2026-11-25',
      labels: ['finances', 'entity:acme', 'fin:pay:acme-card:2026-11-25']
    });
    expect(plan.missing.find((task) => task.kind === 'review')?.labels).toEqual(['finances', 'fin:review:2025-01']);
  });

  test('a fee, double charge or rising bill that ages out of view leaves its task open', () => {
    const plan = financePlan(
      [],
      [
        { id: 'fp-005', label: 'fin:fee:acme-main:2026-08', status: 'open' },
        { id: 'fp-006', label: 'fin:dup:x9', status: 'open' },
        { id: 'fp-007', label: 'fin:rising:ada:streamco:2026-08', status: 'open' },
        { id: 'fp-008', label: 'fin:pay:acme-card:2026-08', status: 'open' }
      ]
    );
    expect(plan.resolved).toEqual([{ id: 'fp-008', label: 'fin:pay:acme-card:2026-08' }]);
  });

  test('a task done or cancelled on purpose is never filed again, and an open one whose insight is gone is closed', () => {
    const plan = financePlan(insights, [
      { id: 'fp-002', label: 'fin:dup:x2', status: 'cancelled' },
      { id: 'fp-003', label: 'fin:pay:acme-card:2026-10', status: 'open' },
      { id: 'fp-004', label: 'fin:pay:acme-card:2026-09', status: 'done' }
    ]);
    expect(plan.missing.map((task) => task.label)).not.toContain('fin:dup:x2');
    expect(plan.resolved).toEqual([{ id: 'fp-003', label: 'fin:pay:acme-card:2026-10' }]);
  });
});
