#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '../../../src/config';
import { hashBuffer } from '../../../src/knowledge/utils';
import { isRecord } from '../../../src/shared/json-block';
import { daysBetween, shiftDate, todayDate } from '../../../src/shared/date';
import { slugify } from '../../../src/tasks/mutate';
import { shiftMonth } from './books';
import {
  argValue,
  type Entity,
  EntityKind,
  type ExistingTask,
  listBlock,
  loadEntities,
  loadExisting,
  orderEntities
} from './calendar';
import { cents, Check, csvFiles, DATA, LINE_MONTHS, loadReceipts, monthOf } from './layout';
import { parseCsv } from './liability';
import { readRates, type UsdRates } from './rates';

/**
 * The finances dashboard's data, built from what the importer wrote under data/ and the rules in
 * RULES.md's learned section. Payee, category and kind are worked out here on every build, never stored, so a rule
 * changed today re-reads every line. Pure apart from `loadFinance`: identical inputs and `today`
 * give identical data.
 *
 * Usage: bun build.ts plan [--today YYYY-MM-DD]   prints { missing, resolved }: the insights to file
 *        as tasks and the open fin: tasks to close
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
  check: Check;
}

export interface Rule {
  match?: string;
  payee?: string;
  category?: string;
  account?: string;
  /** Only lines of this entity, so a pattern that also fits another entity's text can't reach them. */
  entity?: string;
  date?: string;
  for?: string;
  /** One transaction, by its id: a fix for that line alone, checked before every other rule. */
  id?: string;
  /** Approved by the operator; a rule without it is a suggestion. */
  confirmed?: boolean;
}

/** A rule's identity, so the dashboard can name the rule it approves without its place in the file. */
export const ruleKey = (rule: Rule): string => {
  const fields = [rule.match, rule.payee, rule.account, rule.date, rule.id, rule.category, rule.for];
  return hashBuffer(JSON.stringify(rule.entity === undefined ? fields : [...fields, rule.entity]));
};

/** Fixes for one line first, then approved rules, then suggestions, each in file order. */
export const orderRules = (rules: Rule[]): Rule[] => [
  ...rules.filter((rule) => rule.id !== undefined),
  ...rules.filter((rule) => rule.id === undefined && rule.confirmed === true),
  ...rules.filter((rule) => rule.id === undefined && rule.confirmed !== true)
];

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
  /**
   * Whose expense or income it is: the account's entity unless a rule's `for` says otherwise. For a director
   * movement on the operator's own account, the company on the other side.
   */
  for: string;
  /** Matched with the other half of a transfer between the operator's accounts. */
  paired: boolean;
  /** The key of the rule that set the category, and whether the operator approved it. */
  rule: string | null;
  approved: boolean;
  /** Set by a fix for this one line, which a payee-wide rule never overrides. */
  pinned: boolean;
}

const CHARITY = new Set(['charity', 'zakat', 'sadaqah', 'donation']);

/** The categories that set a line's kind, for the page to preview an edit the way a build would. */
export const CATEGORY_KINDS: Readonly<Record<string, Kind>> = {
  ...Object.fromEntries([...CHARITY].map((category) => [category, Kind.Charity])),
  transfer: Kind.Transfer,
  director: Kind.Director
};

/** Spending, charity and income: the lines a category is about. */
const isOwn = (kind: Kind): boolean => kind === Kind.Spend || kind === Kind.Charity || kind === Kind.Income;
const FEE = /\b(fee|charge|charges|penalty|late|interest|commission)\b/i;

const lastDayOf = (month: string): number =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
/** The same day a month later, or that month's last day when it is shorter. */
const nextMonthDay = (date: string): string => {
  const month = shiftMonth(monthOf(date), 1);
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), lastDayOf(month))).padStart(2, '0')}`;
};

const median = (values: number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
};

/** A payee to start from when no rule names one: the description without reference numbers. */
export const defaultPayee = (raw: string): string =>
  raw
    .replace(/\b[\w-]*\d{4,}[\w-]*\b/g, ' ')
    .replace(/[*#/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || raw.slice(0, 40);

const PATTERNS = new Map<string, RegExp>();
const patternOf = (source: string): RegExp => {
  const known = PATTERNS.get(source);
  if (known !== undefined) {
    return known;
  }
  const compiled = new RegExp(source, 'i');
  PATTERNS.set(source, compiled);
  return compiled;
};

const matches = (rule: Rule, text: string): boolean => rule.match !== undefined && patternOf(rule.match).test(text);

const applies = (rule: Rule, txn: Txn): boolean =>
  (rule.id === undefined || rule.id === txn.id) &&
  (rule.account === undefined || rule.account === txn.account) &&
  (rule.entity === undefined || rule.entity === txn.entity) &&
  (rule.date === undefined || txn.date.startsWith(rule.date));

export interface Classified {
  payee: string;
  category: string | null;
  for: string | null;
  /** The key of the rule that set the category, and whether the operator approved it. */
  rule: string | null;
  approved: boolean;
  pinned: boolean;
}

/**
 * Rules run in two passes over rules in `orderRules` order: the first rule naming a payee whose
 * pattern fits the raw description, or the payee it would otherwise get, renames it, then the first rule naming a category that fits the
 * line (its id, the payee by name or pattern before or after the rename, or the raw description) sets it, and the first naming a
 * `for` the same way says whose expense the line is. `account`, `entity` and `date` (a day or a month) narrow any rule.
 */
export const classify = (txn: Txn, rules: Rule[]): Classified => {
  const fallback = defaultPayee(txn.raw);
  const payee =
    rules.find(
      (rule) =>
        rule.payee !== undefined &&
        rule.category === undefined &&
        applies(rule, txn) &&
        (matches(rule, txn.raw) || matches(rule, fallback))
    )?.payee ?? fallback;
  const names = new Set([payee.toLowerCase(), fallback.toLowerCase()]);
  const fits = (rule: Rule): boolean =>
    applies(rule, txn) &&
    (rule.id !== undefined ||
      (rule.payee !== undefined && names.has(rule.payee.toLowerCase())) ||
      matches(rule, txn.raw) ||
      matches(rule, payee) ||
      matches(rule, fallback));
  const categoryRule = rules.find((rule) => rule.category !== undefined && fits(rule));
  return {
    payee,
    category: categoryRule?.category ?? null,
    for: rules.find((rule) => rule.for !== undefined && fits(rule))?.for ?? null,
    rule: categoryRule === undefined ? null : ruleKey(categoryRule),
    approved: categoryRule?.confirmed === true,
    pinned: categoryRule?.id !== undefined
  };
};

/**
 * Pairs money leaving one of the operator's accounts with the same amount arriving in another of
 * them within three days, oldest first and closest date first, each line in at most one pair. A line
 * a rule already gave a category, or marked as paid for another entity, is left to the rule; a line
 * marked director still pairs, so a loan seen from both sides counts once.
 */
const pairTransfers = (txns: Txn[], skip: Set<string>): Map<string, string> => {
  const bucket = (txn: Txn): string => `${txn.currency}|${Math.abs(cents(txn.amount))}`;
  const inflows = Map.groupBy(
    txns.filter((txn) => txn.amount > 0 && !skip.has(txn.id)),
    bucket
  );
  const pairs = new Map<string, string>();
  txns
    .filter((txn) => txn.amount < 0 && !skip.has(txn.id))
    .toSorted((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .forEach((out) => {
      const gap = (inflow: Txn): number => Math.abs(daysBetween(out.date, inflow.date));
      const partner = (inflows.get(bucket(out)) ?? [])
        .filter((inflow) => !pairs.has(inflow.id) && inflow.account !== out.account && gap(inflow) <= 3)
        .toSorted((a, b) => gap(a) - gap(b) || a.id.localeCompare(b.id))[0];
      if (partner !== undefined) {
        pairs.set(out.id, partner.id);
        pairs.set(partner.id, out.id);
      }
    });
  return pairs;
};

const pairKind = (a: Entity | undefined, b: Entity | undefined): Kind => {
  if (a === undefined || b === undefined || a.slug === b.slug) {
    return Kind.Transfer;
  }
  const companies = [a, b].filter((entity) => entity.kind === EntityKind.Company).length;
  return companies === 1 ? Kind.Director : Kind.Between;
};

const kindOf = (paired: Kind | null, category: string | null, amount: number): Kind => {
  if (paired !== null) {
    return paired;
  }
  if (category === 'transfer') {
    return Kind.Transfer;
  }
  if (category === 'director') {
    return Kind.Director;
  }
  if (category !== null && CHARITY.has(category)) {
    return Kind.Charity;
  }
  return amount > 0 ? Kind.Income : Kind.Spend;
};

/** Every line with its payee, category and kind. */
export const classifyAll = (txns: Txn[], rules: Rule[], entities: Entity[]): Line[] => {
  const slugs = entities.map((entity) => entity.slug);
  const unknown = rules
    .flatMap((rule) => [
      ['for', rule.for],
      ['entity', rule.entity]
    ])
    .find(([, slug]) => slug !== undefined && !slugs.includes(slug));
  if (unknown !== undefined) {
    throw new Error(
      `RULES.md: ${unknown[0]}: ${unknown[1]} is not an entity (use a profile's slug: ${slugs.join(', ')})`
    );
  }
  const accountIds = entities.flatMap((entity) => entity.accounts.map((account) => account.id));
  const strayAccount = rules.find((rule) => rule.account !== undefined && !accountIds.includes(rule.account));
  if (strayAccount !== undefined) {
    throw new Error(`RULES.md: account: ${strayAccount.account} is not an account in any profile`);
  }
  const ordered = orderRules(rules);
  const classified = txns.map((txn) => ({ txn, ...classify(txn, ordered) }));
  const ruled = new Set(
    classified
      .filter((line) => (line.category !== null || line.for !== null) && line.category !== 'director')
      .map((line) => line.txn.id)
  );
  const pairs = pairTransfers(txns, ruled);
  const companies = entities.filter((entity) => entity.kind === EntityKind.Company);
  const soleCompany = companies.length === 1 ? (companies[0]?.slug ?? null) : null;
  const byId = new Map(txns.map((txn) => [txn.id, txn]));
  const entityOf = (slug: string | undefined): Entity | undefined => entities.find((entity) => entity.slug === slug);
  return classified.map(({ txn, payee, category, for: owner, rule, approved, pinned }): Line => {
    const partner = byId.get(pairs.get(txn.id) ?? '');
    const kind = kindOf(
      partner === undefined ? null : pairKind(entityOf(txn.entity), entityOf(partner.entity)),
      category,
      txn.amount
    );
    const own = isOwn(kind);
    const personal = entityOf(txn.entity)?.kind === EntityKind.Individual;
    const counterparty =
      kind === Kind.Director && partner === undefined && personal ? (owner ?? soleCompany ?? txn.entity) : txn.entity;
    return {
      ...txn,
      payee,
      category,
      kind,
      for: own ? (owner ?? txn.entity) : counterparty,
      paired: partner !== undefined,
      rule,
      approved,
      pinned
    };
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
 * follows the last; it is missed when the account's statements cover that date and the five days
 * after it without it, and rising when the last payment is 15% or more above the usual.
 */
export const detectRecurring = (lines: Line[], coverage: Map<string, Span[]>): Recurring[] => {
  const groups = Map.groupBy(
    lines.filter((line) => line.amount < 0 && (line.kind === Kind.Spend || line.kind === Kind.Charity)),
    (line) => `${line.for}|${line.currency}|${line.payee.toLowerCase()}`
  );
  return [...groups.values()].flatMap((group): Recurring[] => {
    const sorted = group.toSorted((a, b) => a.date.localeCompare(b.date));
    const intervals = sorted.slice(1).map((line, i) => daysBetween(sorted[i]?.date ?? line.date, line.date));
    const cadence = Object.values(Cadence).find((key) => {
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
    const next = cadence === Cadence.Monthly ? nextMonthDay(last.date) : shiftDate(last.date, 365);
    const covered = (coverage.get(last.account) ?? []).some(
      (span) => span.from <= next && span.to >= shiftDate(next, 6)
    );
    return [
      {
        entity: last.for,
        account: last.account,
        payee: last.payee,
        category: last.category,
        cadence,
        currency: last.currency,
        typical,
        last: -last.amount,
        lastDate: last.date,
        next,
        state: covered ? BillState.Missed : BillState.Upcoming,
        rising: -last.amount >= typical * 1.15,
        count: sorted.length
      }
    ];
  });
};

export interface CheckResult {
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

/**
 * Each statement of one account that reaches past the ones before it, beside the one that reached
 * furthest so far, in date order. A statement inside another's dates adds nothing and is skipped.
 */
const adjacent = (statements: Statement[]): { before: Statement; statement: Statement; gap: number }[] => {
  const [first, ...rest] = statements.toSorted((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  if (first === undefined) {
    return [];
  }
  return rest.reduce<{ reach: Statement; pairs: { before: Statement; statement: Statement; gap: number }[] }>(
    ({ reach, pairs }, statement) =>
      statement.to > reach.to
        ? {
            reach: statement,
            pairs: [...pairs, { before: reach, statement, gap: daysBetween(reach.to, statement.from) }]
          }
        : { reach, pairs },
    { reach: first, pairs: [] }
  ).pairs;
};

export interface Span {
  from: string;
  to: string;
}

/** The date ranges one account's statements cover between them, oldest first. */
const spansOf = (statements: Statement[]): Span[] =>
  statements
    .toSorted((a, b) => a.from.localeCompare(b.from))
    .reduce<Span[]>((spans, statement) => {
      const last = spans.at(-1);
      return last !== undefined && daysBetween(last.to, statement.from) <= 1
        ? [...spans.slice(0, -1), { from: last.from, to: statement.to > last.to ? statement.to : last.to }]
        : [...spans, { from: statement.from, to: statement.to }];
    }, []);

export interface FinanceInput {
  today: string;
  entities: Entity[];
  txns: Txn[];
  statements: Statement[];
  rules: Rule[];
  /** The categories the picker offers: the operator's list, else the skill's defaults. */
  categories?: string[];
  /** Receipt files by the line each was matched to. */
  receipts?: Map<string, string>;
  /** Each company's director balance as its accountant last stated it, from data/director.csv. */
  openings?: Map<string, DirectorOpening>;
  /** Each month's units of each currency per US dollar, from data/rates.csv. */
  rates?: UsdRates;
}

export interface DirectorOpening {
  balance: number;
  on: string;
}

/** A category rule as the dashboard shows it, with how many lines it covers. */
export interface RuleView extends Rule {
  key: string;
  lines: number;
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
  /** Its export prints no balances, so it counts for spending only and is never proven. */
  spendingOnly: boolean;
}

export const Why = { Transfer: 'transfer', PaidForYou: 'paid-for-you', PaidForCompany: 'paid-for-company' } as const;
export type Why = (typeof Why)[keyof typeof Why];

/** One change to what the operator owes a company: positive raises it. */
export interface DirectorMovement {
  date: string;
  amount: number;
  currency: string;
  payee: string;
  category: string | null;
  why: Why;
  /** The amount in the company's currency at its month's rate; null when there's no rate, so it isn't counted. */
  inCompany: number | null;
  /** What the operator owes the company after this movement, in the company's currency. */
  owed: number;
}

/** An amount in another currency at that month's rate per US dollar, or null without a rate for either. */
const convertAt = (rates: UsdRates, amount: number, from: string, to: string, month: string): number | null => {
  const perUsd = (currency: string): number | undefined => (currency === 'USD' ? 1 : rates[month]?.[currency]);
  const [a, b] = [perUsd(from), perUsd(to)];
  return from === to ? amount : a !== undefined && b !== undefined ? (amount * b) / a : null;
};

export interface FinanceData {
  today: string;
  /** The operator's own currency: the All view's local currency. Each entity's own is on `entities`. */
  home: string;
  /** Each month's units of each currency per US dollar, for converting summaries; USD is 1 and never listed. */
  rates: UsdRates;
  entities: { slug: string; name: string; kind: string; currency: string }[];
  accounts: AccountView[];
  /** `entity` is whose expense or income the line is; `paidBy` names the entity whose account paid, when another. */
  lines: {
    id: string;
    date: string;
    account: string;
    entity: string;
    paidBy: string | null;
    amount: number;
    currency: string;
    payee: string;
    category: string | null;
    kind: Kind;
    rule: string | null;
    approved: boolean;
    pinned: boolean;
    /** The matched receipt's file, relative to the finances project. */
    receipt: string | null;
  }[];
  recurring: Recurring[];
  dues: { account: string; entity: string; due: string; amount: number; currency: string; paid: boolean }[];
  director: {
    company: string;
    currency: string;
    opening: number | null;
    openingOn: string | null;
    balance: number;
    movements: DirectorMovement[];
  }[];
  insights: Insight[];
  checks: CheckResult[];
  rules: RuleView[];
  categories: string[];
  kinds: Readonly<Record<string, Kind>>;
  /** Spending, charity and income lines: how many are approved, only suggested, or have no category. */
  approval: { approved: number; suggested: number; uncategorised: number };
}

/** A statement older than this, about one cycle and a few days, means the next one is due. */
const STALE_DAYS = 35;
/** Fees and double charges older than this are history, not something to act on. */
const RECENT_DAYS = 60;

export const buildFinance = ({
  today,
  entities,
  txns,
  statements,
  rules,
  categories = [],
  receipts = new Map(),
  openings = new Map(),
  rates = {}
}: FinanceInput): FinanceData => {
  const accounts = entities.flatMap((entity) => entity.accounts.map((account) => ({ account, entity })));
  const lines = classifyAll(txns, rules, entities);
  const byAccount = Map.groupBy(statements, (statement) => statement.account);
  const coverage = new Map([...byAccount].map(([account, list]) => [account, spansOf(list)]));
  const accountViews = accounts.map(({ account, entity }): AccountView => {
    const latest = (byAccount.get(account.id) ?? []).toSorted((a, b) => a.to.localeCompare(b.to)).at(-1);
    return {
      id: account.id,
      name: account.name,
      entity: entity.slug,
      type: account.type ?? 'current',
      currency: account.currency,
      balance: latest?.closing ?? null,
      asOf: latest?.to ?? null,
      statements: byAccount.get(account.id)?.length ?? 0,
      behind: latest === undefined || daysBetween(latest.to, today) > STALE_DAYS,
      spendingOnly: account.balances === false
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
            daysBetween(statement.due ?? '', line.date) <= 3
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
      const kindOf = (slug: string): string | undefined => entities.find((entity) => entity.slug === slug)?.kind;
      const opening = openings.get(company.slug);
      const moves = lines
        .filter((line) => opening === undefined || line.date > opening.on)
        .toSorted((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        .flatMap((line): Omit<DirectorMovement, 'inCompany' | 'owed'>[] => {
          const base = { date: line.date, currency: line.currency, payee: line.payee, category: line.category };
          if (line.entity === company.slug && line.kind === Kind.Director) {
            return [{ ...base, amount: -line.amount, why: Why.Transfer }];
          }
          if (
            line.kind === Kind.Director &&
            !line.paired &&
            line.for === company.slug &&
            line.entity !== company.slug
          ) {
            return [{ ...base, amount: line.amount, why: Why.Transfer }];
          }
          if (line.entity === company.slug && line.for !== company.slug && kindOf(line.for) === EntityKind.Individual) {
            return [{ ...base, amount: -line.amount, why: Why.PaidForYou }];
          }
          if (
            line.for === company.slug &&
            line.entity !== company.slug &&
            kindOf(line.entity) === EntityKind.Individual
          ) {
            return [{ ...base, amount: line.amount, why: Why.PaidForCompany }];
          }
          return [];
        });
      const movements = moves.reduce<DirectorMovement[]>((done, move) => {
        const inCompany = convertAt(rates, move.amount, move.currency, company.currency, monthOf(move.date));
        const owed = (done.at(-1)?.owed ?? opening?.balance ?? 0) + (inCompany ?? 0);
        return [...done, { ...move, inCompany, owed }];
      }, []);
      if (movements.length === 0 && opening === undefined) {
        return [];
      }
      return [
        {
          company: company.slug,
          currency: company.currency,
          opening: opening?.balance ?? null,
          openingOn: opening?.on ?? null,
          balance: movements.at(-1)?.owed ?? opening?.balance ?? 0,
          movements
        }
      ];
    });
  const recentSpend = lines.filter(
    (line) => line.amount < 0 && line.kind === Kind.Spend && daysBetween(line.date, today) <= RECENT_DAYS
  );
  const duplicates = [
    ...Map.groupBy(recentSpend, (line) => `${line.account}|${cents(line.amount)}|${line.raw}`).values()
  ].flatMap((group) =>
    group
      .toSorted((a, b) => a.date.localeCompare(b.date))
      .filter((line, i, sorted) => i > 0 && daysBetween(sorted[i - 1]?.date ?? line.date, line.date) <= 1)
  );
  const fees = recentSpend.filter((line) => line.category === 'fees' || (line.category === null && FEE.test(line.raw)));
  const uncategorized = Map.groupBy(
    lines.filter((line) => (line.kind === Kind.Spend || line.kind === Kind.Income) && line.category === null),
    (line) => monthOf(line.date)
  );
  const pairs = [...byAccount.values()].flatMap(adjacent);
  const gaps = pairs
    .filter(({ gap }) => gap > 1)
    .map(
      ({ before, statement }) =>
        `${statement.account}: nothing from ${shiftDate(before.to, 1)} to ${shiftDate(statement.from, -1)}`
    );
  const breaks = pairs
    .filter(
      ({ before, statement, gap }) =>
        gap === 1 &&
        before.closing !== null &&
        statement.opening !== null &&
        cents(before.closing) !== cents(statement.opening)
    )
    .map(
      ({ before, statement }) =>
        `${statement.account}: ${statement.from} opens at ${statement.opening}, the statement before closed at ${before.closing}`
    );
  const spendingOnly = accountViews.filter((account) => account.spendingOnly).map((account) => account.id);
  const unproven = statements.filter(
    (statement) => statement.check !== Check.Checked && !spendingOnly.includes(statement.account)
  );
  const unchecked = unproven.map((statement) => `${statement.account}: ${statement.from} to ${statement.to}`);
  const behind = accountViews
    .filter((account) => account.behind)
    .map((account) => `${account.id}: ${account.asOf === null ? 'no statement yet' : `through ${account.asOf}`}`);
  const reviewCount = [...uncategorized.values()].reduce((sum, group) => sum + group.length, 0);
  const counted = lines.filter((line) => isOwn(line.kind));
  const suggestedLines = counted.filter((line) => line.category !== null && !line.approved);
  const suggestedCount = suggestedLines.length;
  const suggestedMonths = suggestedLines.map((line) => monthOf(line.date));
  const checks: CheckResult[] = [
    {
      id: 'proven',
      label: 'Every statement adds up from its opening to its closing',
      ok: unchecked.length === 0,
      items: [
        ...unchecked,
        ...(spendingOnly.length === 0
          ? []
          : [`Not checked, spending only (no balances in the export): ${spendingOnly.join(', ')}`])
      ]
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
      label: `Every account has a statement from the last ${STALE_DAYS} days`,
      ok: behind.length === 0,
      items: behind
    },
    {
      id: 'categories',
      label: 'Every line has a category',
      ok: reviewCount === 0,
      items: [...uncategorized].map(([month, group]) => `${month}: ${group.length} to categorise`)
    },
    {
      id: 'currencies',
      label: 'Every entity has its currency pinned',
      ok: entities.every((entity) => entity.currencyPinned),
      items: entities
        .filter((entity) => !entity.currencyPinned)
        .map((entity) => `${entity.slug}: ${entity.currency} from its country; add currency to its profile`)
    }
  ];
  const accountById = new Map(accounts.map((item) => [item.account.id, item]));
  const accountNameOf = (id: string): string => accountById.get(id)?.account.name ?? id;
  const insights: Insight[] = [
    ...dues
      .filter((due) => !due.paid && daysBetween(today, due.due) <= 7)
      .map((due) => ({
        kind: InsightKind.Pay,
        label: `fin:pay:${due.account}:${due.due}`,
        entity: due.entity,
        title: `Pay the ${accountNameOf(due.account)} statement`,
        due: due.due
      })),
    ...recurring
      .filter((bill) => bill.state === BillState.Missed)
      .map((bill) => ({
        kind: InsightKind.Missed,
        label: `fin:missed:${bill.entity}:${slugify(bill.payee)}:${monthOf(bill.next)}`,
        entity: bill.entity,
        title: `${bill.payee} didn't go out when expected (${bill.next})`,
        due: null
      })),
    ...recurring
      .filter((bill) => bill.rising)
      .map((bill) => ({
        kind: InsightKind.Rising,
        label: `fin:rising:${bill.entity}:${slugify(bill.payee)}:${monthOf(bill.lastDate)}`,
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
    ...[...Map.groupBy(fees, (line) => `${line.account}|${monthOf(line.date)}`).values()].flatMap((group) => {
      const first = group[0];
      return first === undefined
        ? []
        : [
            {
              kind: InsightKind.Fee,
              label: `fin:fee:${first.account}:${monthOf(first.date)}`,
              entity: first.for,
              title: `${group.length === 1 ? 'A fee' : `${group.length} fees`} on ${accountNameOf(first.account)} in ${monthOf(first.date)}`,
              due: null
            }
          ];
    }),
    ...[...Map.groupBy(unproven, (statement) => `${statement.account}|${monthOf(statement.to)}`).values()].flatMap(
      ([first]) =>
        first === undefined
          ? []
          : [
              {
                kind: InsightKind.Check,
                label: `fin:check:${first.account}:${monthOf(first.to)}`,
                entity: accountById.get(first.account)?.entity.slug ?? '',
                title: `Get a ${accountNameOf(first.account)} statement for ${monthOf(first.to)} that shows its balances`,
                due: null
              }
            ]
    ),
    ...(reviewCount === 0 && suggestedCount === 0
      ? []
      : [
          {
            kind: InsightKind.Review,
            label: `fin:review:${[...uncategorized.keys(), ...suggestedMonths].toSorted().at(0) ?? ''}`,
            entity: '',
            title: [
              reviewCount === 0 ? null : `categorise ${reviewCount} transaction${reviewCount === 1 ? '' : 's'}`,
              suggestedCount === 0 ? null : `approve ${suggestedCount} suggested`
            ]
              .filter((part) => part !== null)
              .join(', then ')
              .replace(/^./, (first) => first.toUpperCase()),
            due: null
          }
        ]),
    ...accountViews
      .filter((view) => view.behind && view.asOf !== null && accountById.get(view.id)?.entity.close !== 'monthly')
      .map((view) => ({
        kind: InsightKind.Statement,
        label: `fin:statement:${view.id}:${monthOf(nextMonthDay(view.asOf ?? ''))}`,
        entity: view.entity,
        title: `Download the ${view.name} statement after ${view.asOf}`,
        due: null
      }))
  ];
  const oldest = `${shiftMonth(monthOf(today), 1 - LINE_MONTHS)}-01`;
  const covered = lines.reduce(
    (counts, line) => (line.rule === null ? counts : counts.set(line.rule, (counts.get(line.rule) ?? 0) + 1)),
    new Map<string, number>()
  );
  return {
    today,
    home: entities.find((entity) => entity.kind === EntityKind.Individual)?.currency ?? entities[0]?.currency ?? 'USD',
    rates: Object.fromEntries(Object.entries(rates).filter(([month]) => month >= oldest.slice(0, 7))),
    entities: orderEntities(entities).map((entity) => ({
      slug: entity.slug,
      name: entity.name,
      kind: entity.kind,
      currency: entity.currency
    })),
    accounts: accountViews,
    lines: lines
      .filter((line) => line.date >= oldest)
      .toSorted((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((line) => {
        const own = isOwn(line.kind);
        return {
          id: line.id,
          date: line.date,
          account: line.account,
          entity: own ? line.for : line.entity,
          paidBy: own && line.for !== line.entity ? line.entity : null,
          amount: line.amount,
          currency: line.currency,
          payee: line.payee,
          category: line.category,
          kind: line.kind,
          rule: line.rule,
          approved: line.approved,
          pinned: line.pinned,
          receipt: receipts.get(line.id) ?? null
        };
      }),
    recurring,
    dues,
    director,
    insights,
    checks,
    rules: orderRules(rules)
      .filter((rule) => rule.category !== undefined)
      .map((rule) => ({ ...rule, key: ruleKey(rule), lines: covered.get(ruleKey(rule)) ?? 0 })),
    kinds: CATEGORY_KINDS,
    categories: [
      ...new Set([
        ...categories,
        ...rules.flatMap((rule) => (rule.category === undefined ? [] : [rule.category])),
        ...lines.flatMap((line) => (line.category === null ? [] : [line.category]))
      ])
    ],
    approval: {
      approved: counted.filter((line) => line.approved).length,
      suggested: suggestedCount,
      uncategorised: counted.filter((line) => line.category === null).length
    }
  };
};

const numberOrNull = (text: string | undefined): number | null =>
  text === undefined || text.trim() === '' ? null : Number(text);

const TEXT_FIELDS = ['match', 'payee', 'category', 'account', 'entity', 'date', 'for', 'id'] as const;

const isRule = (value: unknown): value is Rule =>
  isRecord(value) &&
  TEXT_FIELDS.every((key) => value[key] === undefined || typeof value[key] === 'string') &&
  (value.confirmed === undefined || typeof value.confirmed === 'boolean');

/**
 * The `## Learned` section of RULES.md with its `###` headings raised, so its yaml blocks read like
 * any other section; empty when the file has none.
 */
const learnedSection = (raw: string): string => {
  const bounds = learnedBounds(raw);
  return bounds === null ? '' : raw.slice(bounds.start, bounds.end).replace(/^### /gm, '## ');
};

/** Where RULES.md's `## Learned` section starts and ends, or null when the file has none. */
export const learnedBounds = (raw: string): { start: number; end: number } | null => {
  const start = raw.search(/^## Learned[ \t]*$/m);
  if (start === -1) {
    return null;
  }
  const after = raw.slice(start + 1).search(/^## /m);
  return { start, end: after === -1 ? raw.length : start + 1 + after };
};

/**
 * RULES.md's learned rules as written: payee renames under `### Payees`, categories under `### Categories`.
 * A malformed entry or pattern stops the run with it named.
 */
export const learnedRules = (raw: string): { payees: Rule[]; categories: Rule[] } => {
  const learned = learnedSection(raw);
  const payees = listBlock('RULES.md', learned, 'Payees');
  const categories = listBlock('RULES.md', learned, 'Categories');
  const bad = [...payees, ...categories].find((rule) => !isRule(rule));
  if (bad !== undefined) {
    throw new Error(
      `RULES.md: ${JSON.stringify(bad)} is not a rule (match, payee, category, account, entity, date, for and id are text; confirmed is true or false)`
    );
  }
  const isPattern = (source: string): boolean => {
    try {
      patternOf(source);
      return true;
    } catch {
      return false;
    }
  };
  const badPattern = [...payees, ...categories]
    .filter(isRule)
    .find((rule) => rule.match !== undefined && !isPattern(rule.match));
  if (badPattern !== undefined) {
    throw new Error(`RULES.md: ${badPattern.match} is not a valid pattern`);
  }
  return { payees: payees.filter(isRule), categories: categories.filter(isRule) };
};

/** The rules the engine applies: payee renames (which never set a category, a for or an id), then category rules. */
export const parseRules = (raw: string): Rule[] => {
  const { payees, categories } = learnedRules(raw);
  return [...payees.map(({ category: _category, for: _for, id: _id, ...rule }) => rule), ...categories];
};

const CATEGORIES = join(import.meta.dir, '..', 'references', 'categories.md');

/** The picker's categories: RULES.md's own list when it has one, else the skill's defaults. */
const strings = (items: unknown[]): string[] => items.filter((item): item is string => typeof item === 'string');

const categoryList = (rulesRaw: string): string[] => {
  const own = strings(listBlock('RULES.md', rulesRaw, 'Categories I use'));
  return own.length > 0 ? own : strings(listBlock('categories.md', readFileSync(CATEGORIES, 'utf8'), 'Categories'));
};

/** Everything `buildFinance` needs, read from the finances project folder. */
export const loadFinance = (dir: string, today: string): FinanceInput => {
  const entities = loadEntities(dir);
  const owner = new Map(
    entities.flatMap((entity) => entity.accounts.map((account) => [account.id, entity.slug] as const))
  );
  const txns = csvFiles(DATA.transactions(dir)).flatMap((path) =>
    parseCsv(readFileSync(path, 'utf8')).map(
      (row): Txn => ({
        id: row.id ?? '',
        date: row.date ?? '',
        account: row.account ?? '',
        entity: owner.get(row.account ?? '') ?? '',
        amount: Number(row.amount),
        currency: row.currency ?? '',
        raw: row.raw ?? ''
      })
    )
  );
  const statementsPath = DATA.statements(dir);
  const statements = existsSync(statementsPath)
    ? parseCsv(readFileSync(statementsPath, 'utf8')).map(
        (row): Statement => ({
          account: row.account ?? '',
          from: row.period_start ?? '',
          to: row.period_end ?? '',
          opening: numberOrNull(row.opening),
          closing: numberOrNull(row.closing),
          currency: row.currency ?? '',
          due: row.due_date || null,
          amountDue: numberOrNull(row.amount_due),
          check: row.check === Check.Checked ? Check.Checked : Check.Unchecked
        })
      )
    : [];
  const rulesPath = DATA.rules(dir);
  const rulesRaw = existsSync(rulesPath) ? readFileSync(rulesPath, 'utf8') : '';
  const directorPath = DATA.director(dir);
  const stated = existsSync(directorPath)
    ? parseCsv(readFileSync(directorPath, 'utf8')).flatMap((row) => {
        const balance = numberOrNull(row.balance);
        return balance === null || !/^\d{4}-\d{2}-\d{2}$/.test(row.on ?? '')
          ? []
          : [{ company: row.company ?? '', balance, on: row.on ?? '' }];
      })
    : [];
  return {
    today,
    entities,
    txns,
    statements,
    rules: parseRules(rulesRaw),
    categories: categoryList(rulesRaw),
    receipts: new Map(
      loadReceipts(dir).flatMap((receipt) => (receipt.line === '' ? [] : [[receipt.line, receipt.file] as const]))
    ),
    openings: new Map(
      stated
        .toSorted((a, b) => a.on.localeCompare(b.on))
        .map(({ company, balance, on }) => [company, { balance, on }] as const)
    ),
    rates: readRates(dir)
  };
};

export interface PlannedTask extends Insight {
  priority: 'P1' | 'P2';
  labels: string[];
}

export interface FinancePlan {
  missing: PlannedTask[];
  resolved: { id: string; label: string }[];
}

/** Insights that drop out by age rather than by being dealt with: their tasks are never closed for it. */
const AGES_OUT = new Set<string>([InsightKind.Fee, InsightKind.Duplicate, InsightKind.Rising]);

/**
 * The insights no task carries yet, each with the labels and priority to file it under, and the open
 * tasks whose insight is gone (the bill was paid, the statement came in), to close. A fee, double
 * charge or rising bill only ages out of view, so its task stays open for the operator.
 */
export const financePlan = (insights: Insight[], existing: ExistingTask[]): FinancePlan => ({
  missing: insights
    .filter((insight) => !existing.some((task) => task.label === insight.label))
    .map((insight) => ({
      ...insight,
      priority: insight.kind === InsightKind.Pay || insight.kind === InsightKind.Missed ? 'P1' : 'P2',
      labels: ['finances', ...(insight.entity === '' ? [] : [`entity:${insight.entity}`]), insight.label]
    })),
  resolved: existing
    .filter((task) => task.status !== 'done' && task.status !== 'cancelled')
    .filter((task) => !AGES_OUT.has(task.label.split(':')[1] ?? ''))
    .filter((task) => !insights.some((insight) => insight.label === task.label))
    .map((task) => ({ id: task.id, label: task.label }))
});

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dir = argValue(args, '--dir') ?? join(FOLDERS.PROJECTS, 'finances');
  const today = argValue(args, '--today') ?? todayDate();
  const plan: FinancePlan = existsSync(join(dir, 'data'))
    ? financePlan(buildFinance(loadFinance(dir, today)).insights, loadExisting(dir, 'fin:'))
    : { missing: [], resolved: [] };
  console.log(JSON.stringify(plan, null, 2));
}
