#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FOLDERS } from '../../../src/config';
import { todayDate } from '../../../src/shared/date';
import { isRecord } from '../../../src/shared/json-block';
import { monthRange, shiftMonth } from './books';
import { argValue, loadEntities, refuse } from './calendar';
import { csvFiles, csvLine, DATA, monthOf } from './layout';
import { parseCsv } from './liability';

/**
 * Exchange rates for the finances page's summaries: each month's rate per US dollar for every
 * currency the project's entities and accounts use, fetched from Frankfurter (central-bank reference
 * rates, no key) into data/rates.csv. Only currency codes and dates leave the machine. Offline, the
 * rates already saved stay, and the page leaves out what it can't convert.
 *
 * Usage: bun rates.ts update [--dir <finances project>] [--today YYYY-MM-DD]
 */

const HEADER = 'month,currency,per_usd,source';
const SOURCE = 'frankfurter';
const ENDPOINT = 'https://api.frankfurter.dev/v2/rates';
/** As far back as the page shows lines. */
const MONTHS = 60;

/** Each month's units of each currency per US dollar. */
export type Rates = Record<string, Record<string, number>>;

export const readRates = (dir: string): Rates =>
  (existsSync(DATA.rates(dir)) ? parseCsv(readFileSync(DATA.rates(dir), 'utf8')) : []).reduce<Rates>((rates, row) => {
    const rate = Number(row.per_usd);
    return row.month && row.currency && Number.isFinite(rate) && rate > 0
      ? { ...rates, [row.month]: { ...rates[row.month], [row.currency]: rate } }
      : rates;
  }, {});

export type Fetcher = (url: string) => Promise<unknown>;

const fetchJson: Fetcher = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`${response.status} from ${new URL(url).host}`);
  }
  return response.json();
};

/** The first month any statement covers, or null before the first import. */
const firstMonth = (dir: string): string | null =>
  [
    ...(existsSync(DATA.statements(dir)) ? parseCsv(readFileSync(DATA.statements(dir), 'utf8')) : []).map(
      (row) => row.period_start ?? ''
    ),
    ...csvFiles(DATA.transactions(dir)).flatMap((path) =>
      parseCsv(readFileSync(path, 'utf8')).map((row) => row.date ?? '')
    )
  ]
    .filter((date) => /^\d{4}-\d{2}/.test(date))
    .map(monthOf)
    .toSorted()[0] ?? null;

export interface RatesReport {
  currencies: string[];
  added: number;
  /** Currencies the source couldn't price, each with why. */
  missing: string[];
}

/**
 * Fetches every month not saved yet, from the first statement month (five years at most) to this
 * one, for each currency in use but the dollar. The current month is fetched again until it ends.
 */
export const updateRates = async (dir: string, today: string, fetcher: Fetcher = fetchJson): Promise<RatesReport> => {
  const entities = loadEntities(dir);
  const currencies = [
    ...new Set(
      entities.flatMap((entity) => [
        entity.currency,
        ...entity.accounts.map((account) => account.currency ?? entity.currency)
      ])
    )
  ]
    .filter((currency) => currency !== 'USD')
    .toSorted();
  const current = monthOf(today);
  const start = firstMonth(dir);
  const saved = readRates(dir);
  const from = [start ?? current, shiftMonth(current, 1 - MONTHS)].toSorted().at(-1) ?? current;
  const months = monthRange(from, current);
  const none: [string, number][] = [];
  const results = await Promise.all(
    currencies.map(async (currency) => {
      const wanted = months.filter((month) => month === current || saved[month]?.[currency] === undefined);
      if (wanted.length === 0) {
        return { currency, rows: none, error: null };
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
        return { currency, rows: none, error: error instanceof Error ? error.message : String(error) };
      }
    })
  );
  const merged = results.reduce<Rates>(
    (rates, { currency, rows }) =>
      rows.reduce<Rates>((acc, [month, rate]) => ({ ...acc, [month]: { ...acc[month], [currency]: rate } }), rates),
    saved
  );
  const lines = Object.entries(merged)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .flatMap(([month, byCurrency]) =>
      Object.entries(byCurrency)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([currency, rate]) => csvLine([month, currency, rate, SOURCE]))
    );
  const added = results.reduce((sum, { rows }) => sum + rows.length, 0);
  if (added > 0) {
    mkdirSync(dirname(DATA.rates(dir)), { recursive: true });
    writeFileSync(DATA.rates(dir), `${[HEADER, ...lines].join('\n')}\n`);
  }
  return {
    currencies,
    added,
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
