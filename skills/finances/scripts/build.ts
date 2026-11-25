#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Entity, EntityKind, listBlock, loadEntities } from './calendar';
import { parseCsv } from './liability';

/**
 * The finances dashboard's data, built from what the importer wrote under data/ and the rules in
 * rules.md. Payee, category and kind are worked out here on every build, never stored, so a rule
 * changed today re-reads every line. Pure apart from `loadFinance`: identical inputs and `today`
 * give identical data.
 */

export interface Txn {
  id: string;
  date: string;
  account: string;
  entity: string;
  amount: number;
  currency: string;
  raw: string;
}

export interface Statement {
  account: string;
  from: string;
  to: string;
  opening: number | null;
  closing: number | null;
  currency: string;
  due: string | null;
  amountDue: number | null;
  check: string;
}

export interface Rule {
  match?: string;
  payee?: string;
  category?: string;
  account?: string;
}

export const Kind = {
  Spend: 'spend',
  Income: 'income',
  Charity: 'charity',
  Transfer: 'transfer',
  Director: 'director',
  Between: 'between'
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export interface Line extends Txn {
  payee: string;
  category: string | null;
  kind: Kind;
}

export const CHARITY = new Set(['charity', 'zakat', 'sadaqah', 'donation']);
const FEE = /\b(fee|charge|charges|penalty|late|interest|commission)\b/i;
const DAY = 86_400_000;

const days = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY;
const isoDay = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10);
const cents = (amount: number): number => Math.round(amount * 100);
const monthOf = (date: string): string => date.slice(0, 7);
const shiftMonth = (month: string, by: number): string => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};
const lastDayOf = (month: string): number =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
/** The same day a month later, or that month's last day when it is shorter. */
const nextMonthDay = (date: string): string => {
  const month = shiftMonth(monthOf(date), 1);
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), lastDayOf(month))).padStart(2, '0')}`;
};
const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const median = (values: number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
};

/** A payee to start from when no rule names one: the description without reference numbers. */
export const defaultPayee = (raw: string): string =>
  raw
    .replace(/\b[\w-]*\d{4,}[\w-]*\b/g, ' ')
    .replace(/[*#/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || raw.slice(0, 40);

const matches = (rule: Rule, text: string): boolean =>
  rule.match !== undefined && new RegExp(rule.match, 'i').test(text);

const applies = (rule: Rule, txn: Txn): boolean => rule.account === undefined || rule.account === txn.account;

/**
 * Rules run in two passes, in file order: the first rule naming a payee whose pattern fits the raw
 * description renames it, then the first rule naming a category that fits the payee (by name or
 * pattern) or the raw description sets it.
 */
export const classify = (txn: Txn, rules: Rule[]): { payee: string; category: string | null } => {
  const payee =
    rules.find(
      (rule) => rule.payee !== undefined && rule.category === undefined && applies(rule, txn) && matches(rule, txn.raw)
    )?.payee ?? defaultPayee(txn.raw);
  const category =
    rules.find(
      (rule) =>
        rule.category !== undefined &&
        applies(rule, txn) &&
        ((rule.payee !== undefined && rule.payee.toLowerCase() === payee.toLowerCase()) ||
          matches(rule, txn.raw) ||
          matches(rule, payee))
    )?.category ?? null;
  return { payee, category };
};

/**
 * Pairs money leaving one of the operator's accounts with the same amount arriving in another of
 * them within three days, oldest first and closest date first, each line in at most one pair. Lines
 * a rule already marked as a transfer or director movement are left to the rule.
 */
export const pairTransfers = (txns: Txn[], skip: Set<string>): Map<string, string> => {
  const inflows = txns.filter((txn) => txn.amount > 0 && !skip.has(txn.id));
  return txns
    .filter((txn) => txn.amount < 0 && !skip.has(txn.id))
    .toSorted((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .reduce((pairs, out) => {
      const partner = inflows
        .filter(
          (inflow) =>
            !pairs.has(inflow.id) &&
            inflow.account !== out.account &&
            inflow.currency === out.currency &&
            cents(inflow.amount) === -cents(out.amount) &&
            Math.abs(days(inflow.date) - days(out.date)) <= 3
        )
        .toSorted(
          (a, b) =>
            Math.abs(days(a.date) - days(out.date)) - Math.abs(days(b.date) - days(out.date)) ||
            a.id.localeCompare(b.id)
        )[0];
      return partner === undefined ? pairs : new Map([...pairs, [out.id, partner.id], [partner.id, out.id]]);
    }, new Map<string, string>());
};

const pairKind = (a: Entity | undefined, b: Entity | undefined): Kind => {
  if (a === undefined || b === undefined || a.slug === b.slug) {
    return Kind.Transfer;
  }
  const companies = [a, b].filter((entity) => entity.kind === EntityKind.Company).length;
  return companies === 1 ? Kind.Director : Kind.Between;
};

/** Every line with its payee, category and kind. */
export const classifyAll = (txns: Txn[], rules: Rule[], entities: Entity[]): Line[] => {
  const classified = txns.map((txn) => ({ txn, ...classify(txn, rules) }));
  const ruled = new Set(
    classified.filter((line) => line.category === 'transfer' || line.category === 'director').map((line) => line.txn.id)
  );
  const pairs = pairTransfers(txns, ruled);
  const byId = new Map(txns.map((txn) => [txn.id, txn]));
  const entityOf = (slug: string | undefined): Entity | undefined => entities.find((entity) => entity.slug === slug);
  return classified.map(({ txn, payee, category }): Line => {
    const partner = byId.get(pairs.get(txn.id) ?? '');
    const kind: Kind =
      partner !== undefined
        ? pairKind(entityOf(txn.entity), entityOf(partner.entity))
        : category === 'transfer'
          ? Kind.Transfer
          : category === 'director'
            ? Kind.Director
            : category !== null && CHARITY.has(category)
              ? Kind.Charity
              : txn.amount > 0
                ? Kind.Income
                : Kind.Spend;
    return { ...txn, payee, category, kind };
  });
};

export const Cadence = { Monthly: 'monthly', Yearly: 'yearly' } as const;
export type Cadence = (typeof Cadence)[keyof typeof Cadence];

export const BillState = { Upcoming: 'upcoming', Missed: 'missed' } as const;
export type BillState = (typeof BillState)[keyof typeof BillState];

export interface Recurring {
  entity: string;
  account: string;
  payee: string;
  category: string | null;
  cadence: Cadence;
  currency: string;
  typical: number;
  last: number;
  lastDate: string;
  next: string;
  state: BillState;
  rising: boolean;
  count: number;
}

const BANDS: Record<Cadence, [number, number]> = { monthly: [25, 35], yearly: [355, 375] };

/**
 * A payee paid three or more times at a steady interval (monthly or yearly, within five days) and a
 * steady amount (two in three within 20% of the usual) is a recurring payment. Its next date
 * follows the last; it is missed when the account's statements already run five days past that
 * date without it, and rising when the last payment is 15% or more above the usual.
 */
export const detectRecurring = (lines: Line[], coverage: Map<string, string>): Recurring[] => {
  const groups = Map.groupBy(
    lines.filter((line) => line.amount < 0 && (line.kind === Kind.Spend || line.kind === Kind.Charity)),
    (line) => `${line.entity}|${line.currency}|${line.payee.toLowerCase()}`
  );
  return [...groups.values()].flatMap((group): Recurring[] => {
    const sorted = group.toSorted((a, b) => a.date.localeCompare(b.date));
    const intervals = sorted.slice(1).map((line, i) => days(line.date) - days(sorted[i]?.date ?? line.date));
    const cadence = (Object.keys(BANDS) as Cadence[]).find((key) => {
      const [low, high] = BANDS[key];
      return intervals.filter((gap) => gap >= low && gap <= high).length * 3 >= intervals.length * 2;
    });
    const last = sorted.at(-1);
    if (sorted.length < 3 || cadence === undefined || last === undefined) {
      return [];
    }
    const amounts = sorted.map((line) => -line.amount);
    const typical = median(amounts.slice(0, -1));
    if (amounts.filter((amount) => Math.abs(amount - typical) <= typical * 0.2).length * 3 < amounts.length * 2) {
      return [];
    }
    const next = cadence === Cadence.Monthly ? nextMonthDay(last.date) : isoDay(days(last.date) + 365);
    const covered = coverage.get(last.account);
    return [
      {
        entity: last.entity,
        account: last.account,
        payee: last.payee,
        category: last.category,
        cadence,
        currency: last.currency,
        typical,
        last: -last.amount,
        lastDate: last.date,
        next,
        state: covered !== undefined && days(covered) > days(next) + 5 ? BillState.Missed : BillState.Upcoming,
        rising: -last.amount >= typical * 1.15,
        count: sorted.length
      }
    ];
  });
};

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  items: string[];
}

export const InsightKind = {
  Pay: 'pay',
  Missed: 'missed',
  Rising: 'rising',
  Duplicate: 'dup',
  Fee: 'fee',
  Check: 'check',
  Review: 'review',
  Statement: 'statement'
} as const;
export type InsightKind = (typeof InsightKind)[keyof typeof InsightKind];

/** Something worth the operator's attention, keyed by a label that files it as one task, never two. */
export interface Insight {
  kind: InsightKind;
  label: string;
  entity: string;
  title: string;
  due: string | null;
}

const monthEnd = (month: string): string => `${month}-${String(lastDayOf(month)).padStart(2, '0')}`;
const previousMonth = (today: string): string => shiftMonth(monthOf(today), -1);

/** The statements of one account in date order, with the gaps between them and the openings that don't follow. */
const continuity = (statements: Statement[]): { gaps: string[]; breaks: string[] } => {
  const sorted = statements.toSorted((a, b) => a.from.localeCompare(b.from));
  return sorted.slice(1).reduce(
    (acc, statement, i) => {
      const before = sorted[i];
      if (before === undefined) {
        return acc;
      }
      const gap =
        days(statement.from) - days(before.to) > 1
          ? [`${statement.account}: nothing from ${isoDay(days(before.to) + 1)} to ${isoDay(days(statement.from) - 1)}`]
          : [];
      const broken =
        before.closing !== null &&
        statement.opening !== null &&
        days(statement.from) - days(before.to) === 1 &&
        cents(before.closing) !== cents(statement.opening)
          ? [
              `${statement.account}: ${statement.from} opens at ${statement.opening}, the statement before closed at ${before.closing}`
            ]
          : [];
      return { gaps: [...acc.gaps, ...gap], breaks: [...acc.breaks, ...broken] };
    },
    { gaps: [] as string[], breaks: [] as string[] }
  );
};

export interface FinanceInput {
  today: string;
  entities: Entity[];
  txns: Txn[];
  statements: Statement[];
  rules: Rule[];
}

export interface AccountView {
  id: string;
  name: string;
  entity: string;
  type: string;
  currency: string;
  balance: number | null;
  asOf: string | null;
  statements: number;
  behind: boolean;
}

export interface FinanceData {
  today: string;
  base: string;
  entities: { slug: string; name: string; kind: string }[];
  accounts: AccountView[];
  lines: {
    date: string;
    account: string;
    entity: string;
    amount: number;
    currency: string;
    payee: string;
    category: string | null;
    kind: Kind;
  }[];
  recurring: Recurring[];
  dues: { account: string; entity: string; due: string; amount: number; currency: string; paid: boolean }[];
  director: {
    company: string;
    currency: string;
    opening: number | null;
    openingOn: string | null;
    balance: number;
    movements: { date: string; amount: number; payee: string }[];
  }[];
  insights: Insight[];
  checks: Check[];
}

const LINE_MONTHS = 13;

export const buildFinance = ({ today, entities, txns, statements, rules }: FinanceInput): FinanceData => {
  const accounts = entities.flatMap((entity) => entity.accounts.map((account) => ({ account, entity })));
  const lines = classifyAll(txns, rules, entities);
  const byAccount = Map.groupBy(statements, (statement) => statement.account);
  const coverage = new Map(
    [...byAccount].map(([account, list]) => [
      account,
      list
        .map((statement) => statement.to)
        .toSorted()
        .at(-1) ?? ''
    ])
  );
  const lastMonthEnd = monthEnd(previousMonth(today));
  const accountViews = accounts.map(({ account, entity }): AccountView => {
    const latest = (byAccount.get(account.id) ?? []).toSorted((a, b) => a.to.localeCompare(b.to)).at(-1);
    return {
      id: account.id,
      name: account.name,
      entity: entity.slug,
      type: account.type ?? 'current',
      currency: account.currency ?? 'MYR',
      balance: latest?.closing ?? null,
      asOf: latest?.to ?? null,
      statements: byAccount.get(account.id)?.length ?? 0,
      behind: latest === undefined || latest.to < lastMonthEnd
    };
  });
  const recurring = detectRecurring(lines, coverage);
  const dues = statements
    .filter((statement) => statement.due !== null && (statement.amountDue ?? 0) > 0)
    .map((statement) => {
      const owner = accounts.find(({ account }) => account.id === statement.account);
      const paidIn = lines
        .filter(
          (line) =>
            line.account === statement.account &&
            line.amount > 0 &&
            line.date > statement.to &&
            days(line.date) <= days(statement.due ?? '') + 3
        )
        .reduce((sum, line) => sum + cents(line.amount), 0);
      return {
        account: statement.account,
        entity: owner?.entity.slug ?? '',
        due: statement.due ?? '',
        amount: statement.amountDue ?? 0,
        currency: statement.currency,
        paid: paidIn >= cents(statement.amountDue ?? 0)
      };
    });
  const director = entities
    .filter((entity) => entity.kind === EntityKind.Company)
    .flatMap((company) => {
      const movements = lines
        .filter((line) => line.entity === company.slug && line.kind === Kind.Director)
        .filter((line) => company.directorBalanceOn === null || line.date > company.directorBalanceOn)
        .map((line) => ({ date: line.date, amount: -line.amount, payee: line.payee }));
      if (movements.length === 0 && company.directorBalance === null) {
        return [];
      }
      const currency = accountViews.find((account) => account.entity === company.slug)?.currency ?? 'MYR';
      return [
        {
          company: company.slug,
          currency,
          opening: company.directorBalance,
          openingOn: company.directorBalanceOn,
          balance: (company.directorBalance ?? 0) + movements.reduce((sum, movement) => sum + movement.amount, 0),
          movements
        }
      ];
    });
  const duplicates = [
    ...Map.groupBy(
      lines.filter((line) => line.amount < 0 && line.kind === Kind.Spend),
      (line) => `${line.account}|${cents(line.amount)}|${line.payee.toLowerCase()}`
    ).values()
  ].flatMap((group) =>
    group
      .toSorted((a, b) => a.date.localeCompare(b.date))
      .filter((line, i, sorted) => i > 0 && days(line.date) - days(sorted[i - 1]?.date ?? line.date) <= 2)
  );
  const firstMonth = lines.reduce((first, line) => {
    const key = line.payee.toLowerCase();
    const month = monthOf(line.date);
    return (first.get(key) ?? month) < month ? first : first.set(key, month);
  }, new Map<string, string>());
  const fees = lines.filter(
    (line) =>
      line.amount < 0 &&
      line.kind === Kind.Spend &&
      (line.category === 'fees' || (line.category === null && FEE.test(line.raw))) &&
      firstMonth.get(line.payee.toLowerCase()) === monthOf(line.date)
  );
  const uncategorized = Map.groupBy(
    lines.filter((line) => (line.kind === Kind.Spend || line.kind === Kind.Income) && line.category === null),
    (line) => monthOf(line.date)
  );
  const { gaps, breaks } = [...byAccount.values()]
    .map(continuity)
    .reduce((acc, result) => ({ gaps: [...acc.gaps, ...result.gaps], breaks: [...acc.breaks, ...result.breaks] }), {
      gaps: [] as string[],
      breaks: [] as string[]
    });
  const unchecked = statements
    .filter((statement) => statement.check !== 'checked')
    .map((statement) => `${statement.account}: ${statement.from} to ${statement.to}`);
  const behind = accountViews
    .filter((account) => account.behind)
    .map((account) => `${account.id}: ${account.asOf === null ? 'no statement yet' : `through ${account.asOf}`}`);
  const reviewCount = [...uncategorized.values()].reduce((sum, group) => sum + group.length, 0);
  const checks: Check[] = [
    {
      id: 'proven',
      label: 'Every statement adds up from its opening to its closing',
      ok: unchecked.length === 0,
      items: unchecked
    },
    { id: 'gaps', label: 'No days missing between statements', ok: gaps.length === 0, items: gaps },
    {
      id: 'openings',
      label: 'Each statement opens where the one before closed',
      ok: breaks.length === 0,
      items: breaks
    },
    {
      id: 'current',
      label: `Every account has a statement through ${lastMonthEnd}`,
      ok: behind.length === 0,
      items: behind
    },
    {
      id: 'categories',
      label: 'Every line has a category',
      ok: reviewCount === 0,
      items: [...uncategorized].map(([month, group]) => `${month}: ${group.length} to categorise`)
    }
  ];
  const entityOfAccount = (id: string): string => accounts.find(({ account }) => account.id === id)?.entity.slug ?? '';
  const accountNameOf = (id: string): string => accounts.find(({ account }) => account.id === id)?.account.name ?? id;
  const insights: Insight[] = [
    ...dues
      .filter((due) => !due.paid && days(due.due) - days(today) <= 7)
      .map((due) => ({
        kind: InsightKind.Pay,
        label: `fin:pay:${due.account}:${monthOf(due.due)}`,
        entity: due.entity,
        title: `Pay the ${accountNameOf(due.account)} statement`,
        due: due.due
      })),
    ...recurring
      .filter((bill) => bill.state === BillState.Missed)
      .map((bill) => ({
        kind: InsightKind.Missed,
        label: `fin:missed:${slugOf(bill.payee)}:${monthOf(bill.next)}`,
        entity: bill.entity,
        title: `${bill.payee} didn't go out when expected (${bill.next})`,
        due: null
      })),
    ...recurring
      .filter((bill) => bill.rising)
      .map((bill) => ({
        kind: InsightKind.Rising,
        label: `fin:rising:${slugOf(bill.payee)}:${monthOf(bill.lastDate)}`,
        entity: bill.entity,
        title: `${bill.payee} went up on ${bill.lastDate}`,
        due: null
      })),
    ...duplicates.map((line) => ({
      kind: InsightKind.Duplicate,
      label: `fin:dup:${line.id}`,
      entity: line.entity,
      title: `Possible double charge from ${line.payee} on ${line.date}`,
      due: null
    })),
    ...fees.map((line) => ({
      kind: InsightKind.Fee,
      label: `fin:fee:${slugOf(line.payee)}:${monthOf(line.date)}`,
      entity: line.entity,
      title: `New fee from ${line.payee} on ${line.date}`,
      due: null
    })),
    ...statements
      .filter((statement) => statement.check !== 'checked')
      .map((statement) => ({
        kind: InsightKind.Check,
        label: `fin:check:${statement.account}:${monthOf(statement.to)}`,
        entity: entityOfAccount(statement.account),
        title: `Get a ${accountNameOf(statement.account)} statement for ${monthOf(statement.to)} that shows its balances`,
        due: null
      })),
    ...(reviewCount === 0
      ? []
      : [
          {
            kind: InsightKind.Review,
            label: `fin:review:${[...uncategorized.keys()].toSorted().at(-1) ?? ''}`,
            entity: '',
            title: `Categorise ${reviewCount} transactions no rule covers yet`,
            due: null
          }
        ]),
    ...accounts
      .filter(({ entity }) => entity.close !== 'monthly')
      .flatMap(({ account, entity }) => {
        const view = accountViews.find((item) => item.id === account.id);
        return view !== undefined && view.statements > 0 && view.behind
          ? [
              {
                kind: InsightKind.Statement,
                label: `fin:statement:${account.id}:${previousMonth(today)}`,
                entity: entity.slug,
                title: `Download the ${account.name} statement for ${previousMonth(today)}`,
                due: null
              }
            ]
          : [];
      })
  ];
  const oldest = `${shiftMonth(monthOf(today), 1 - LINE_MONTHS)}-01`;
  return {
    today,
    base: 'MYR',
    entities: entities.map((entity) => ({ slug: entity.slug, name: entity.name, kind: entity.kind })),
    accounts: accountViews,
    lines: lines
      .filter((line) => line.date >= oldest)
      .toSorted((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map(({ date, account, entity, amount, currency, payee, category, kind }) => ({
        date,
        account,
        entity,
        amount,
        currency,
        payee,
        category,
        kind
      })),
    recurring,
    dues,
    director,
    insights,
    checks
  };
};

const csvFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.csv'))
        .map((file) => join(dir, file))
    : [];

const numberOrNull = (text: string | undefined): number | null =>
  text === undefined || text.trim() === '' ? null : Number(text);

const isRule = (value: unknown): value is Rule =>
  typeof value === 'object' &&
  value !== null &&
  ['match', 'payee', 'category', 'account'].every(
    (key) => !(key in value) || typeof (value as Record<string, unknown>)[key] === 'string'
  );

/** Reads rules.md: payee renames under `## Payees`, categories under `## Categories`, each a yaml list. */
export const parseRules = (raw: string): Rule[] => {
  const payees = listBlock('rules.md', raw, 'Payees');
  const categories = listBlock('rules.md', raw, 'Categories');
  const bad = [...payees, ...categories].find((rule) => !isRule(rule));
  if (bad !== undefined) {
    throw new Error(`rules.md: ${JSON.stringify(bad)} is not a rule (match, payee, category and account are text)`);
  }
  const rules = [...payees.filter(isRule).map(({ category: _ignored, ...rule }) => rule), ...categories.filter(isRule)];
  const badPattern = rules.find((rule) => {
    try {
      return rule.match !== undefined && new RegExp(rule.match, 'i') === null;
    } catch {
      return true;
    }
  });
  if (badPattern !== undefined) {
    throw new Error(`rules.md: ${badPattern.match} is not a valid pattern`);
  }
  return rules;
};

/** Everything `buildFinance` needs, read from the finances project folder. */
export const loadFinance = (dir: string, today: string): FinanceInput => {
  const entities = loadEntities(dir);
  const owner = new Map(
    entities.flatMap((entity) => entity.accounts.map((account) => [account.id, entity.slug] as const))
  );
  const txns = csvFiles(join(dir, 'data', 'transactions')).flatMap((path) =>
    parseCsv(readFileSync(path, 'utf8')).map(
      (row): Txn => ({
        id: row.id ?? '',
        date: row.date ?? '',
        account: row.account ?? '',
        entity: owner.get(row.account ?? '') ?? '',
        amount: Number(row.amount),
        currency: row.currency || 'MYR',
        raw: row.raw ?? ''
      })
    )
  );
  const statementsPath = join(dir, 'data', 'statements.csv');
  const statements = existsSync(statementsPath)
    ? parseCsv(readFileSync(statementsPath, 'utf8')).map(
        (row): Statement => ({
          account: row.account ?? '',
          from: row.period_start ?? '',
          to: row.period_end ?? '',
          opening: numberOrNull(row.opening),
          closing: numberOrNull(row.closing),
          currency: row.currency || 'MYR',
          due: row.due_date || null,
          amountDue: numberOrNull(row.amount_due),
          check: row.check ?? ''
        })
      )
    : [];
  const rulesPath = join(dir, 'rules.md');
  return {
    today,
    entities,
    txns,
    statements,
    rules: existsSync(rulesPath) ? parseRules(readFileSync(rulesPath, 'utf8')) : []
  };
};
