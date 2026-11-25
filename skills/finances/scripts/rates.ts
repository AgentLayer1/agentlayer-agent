#!/usr/bin/env bun
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FOLDERS } from '../../../src/config';
import { todayDate } from '../../../src/shared/date';
import { isRecord } from '../../../src/shared/json-block';
import { trailingMonths } from './books';
import { argValue, loadEntities, refuse } from './calendar';
import { csvLine, DATA, LINE_MONTHS, monthOf, readRows } from './layout';

/**
 * Exchange rates for the finances page's summaries: each month's rate per US dollar for every
 * currency the project's entities and accounts use, fetched from Frankfurter (central-bank reference
 * rates, no key) into data/rates.csv. Only currency codes and dates leave the machine. Offline, the
 * rates already saved stay, and the page leaves out what it can't convert.
 *
 * Usage: bun rates.ts update [--dir <finances project>] [--today YYYY-MM-DD]
 */

const HEADER = 'month,currency,per_usd';
const ENDPOINT = 'https://api.frankfurter.dev/v2/rates';

/** Each month's units of each currency per US dollar. */
export type UsdRates = Record<string, Record<string, number>>;

const withRate = (rates: UsdRates, month: string, currency: string, rate: number): UsdRates => ({
  ...rates,
  [month]: { ...rates[month], [currency]: rate }
});

export const readRates = (dir: string): UsdRates =>
  readRows(DATA.rates(dir)).reduce<UsdRates>((rates, row) => {
    const rate = Number(row.per_usd);
    return row.month && row.currency && Number.isFinite(rate) && rate > 0
      ? withRate(rates, row.month, row.currency, rate)
      : rates;
  }, {});

type Fetcher = (url: string) => Promise<unknown>;

const fetchJson: Fetcher = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`${response.status} from ${new URL(url).host}`);
  }
  return response.json();
};

/** The first month any imported statement covers, or null before the first import. */
const firstMonth = (dir: string): string | null =>
  readRows(DATA.statements(dir))
    .map((row) => row.period_start ?? '')
    .filter((date) => /^\d{4}-\d{2}/.test(date))
    .map(monthOf)
    .toSorted()[0] ?? null;

export interface RatesReport {
  currencies: string[];
  added: number;
  /** Currencies the source couldn't price, each with why. */
  missing: string[];
}

interface Fetched {
  currency: string;
  rows: [string, number][];
  error: string | null;
}

/**
 * Fetches every month not saved yet, from the first statement month (five years at most) to this
 * one, for each currency in use but the dollar. The current month's rate moves until it ends, so it
 * is fetched again once a day.
 */
export const updateRates = async (dir: string, today: string, fetcher: Fetcher = fetchJson): Promise<RatesReport> => {
  const entities = loadEntities(dir);
  const currencies = [
    ...new Set(entities.flatMap((entity) => [entity.currency, ...entity.accounts.map((account) => account.currency)]))
  ]
    .filter((currency) => currency !== 'USD')
    .toSorted();
  const current = monthOf(today);
  const start = firstMonth(dir) ?? current;
  const saved = readRates(dir);
  const savedToday = existsSync(DATA.rates(dir)) && todayDate(statSync(DATA.rates(dir)).mtime) === today;
  const months = trailingMonths(today, LINE_MONTHS).filter((month) => month >= start);
  const results = await Promise.all(
    currencies.map(async (currency): Promise<Fetched> => {
      const wanted = months.filter(
        (month) => saved[month]?.[currency] === undefined || (month === current && !savedToday)
      );
      if (wanted.length === 0) {
        return { currency, rows: [], error: null };
      }
      const url = `${ENDPOINT}?from=${wanted[0]}-01&to=${today}&base=usd&quotes=${currency.toLowerCase()}&group=month`;
      try {
        const body = await fetcher(url);
        const rows = (Array.isArray(body) ? body : []).flatMap((item): [string, number][] =>
          isRecord(item) && typeof item.date === 'string' && typeof item.rate === 'number' && item.rate > 0
            ? [[item.date.slice(0, 7), item.rate]]
            : []
        );
        return { currency, rows: rows.filter(([month]) => wanted.includes(month)), error: null };
      } catch (error) {
        return { currency, rows: [], error: error instanceof Error ? error.message : String(error) };
      }
    })
  );
  const changed = results.flatMap(({ currency, rows }) =>
    rows
      .filter(([month, rate]) => saved[month]?.[currency] !== rate)
      .map(([month, rate]) => ({ month, currency, rate }))
  );
  if (changed.length > 0) {
    const merged = changed.reduce((rates, { month, currency, rate }) => withRate(rates, month, currency, rate), saved);
    const lines = Object.entries(merged)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .flatMap(([month, byCurrency]) =>
        Object.entries(byCurrency)
          .toSorted(([a], [b]) => a.localeCompare(b))
          .map(([currency, rate]) => csvLine([month, currency, rate]))
      );
    mkdirSync(dirname(DATA.rates(dir)), { recursive: true });
    writeFileSync(DATA.rates(dir), `${[HEADER, ...lines].join('\n')}\n`);
  }
  return {
    currencies,
    added: changed.length,
    missing: results.flatMap(({ currency, error }) => (error === null ? [] : [`${currency}: ${error}`]))
  };
};

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  const dir = argValue(rest, '--dir') ?? join(FOLDERS.PROJECTS, 'finances');
  const today = argValue(rest, '--today') ?? todayDate();
  if (command !== 'update') {
    console.error('usage: bun rates.ts update [--dir D] [--today YYYY-MM-DD]');
    process.exit(1);
  }
  updateRates(dir, today)
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch(refuse);
}
