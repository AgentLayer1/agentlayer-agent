#!/usr/bin/env bun
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { FOLDERS } from '../../../src/config';
import { hashBuffer } from '../../../src/knowledge/utils';
import { daysBetween, todayDate } from '../../../src/shared/date';
import { slugify } from '../../../src/tasks/mutate';
import { classifyAll, loadFinance } from './build';
import { argValue, loadEntities, positionals, refuse } from './calendar';
import { cents, csvLine, DATA, loadReceipts, monthOf, type Receipt } from './layout';

/**
 * Receipts for the finances skill: each one the agent reads is filed under data/receipts/ and
 * recorded in data/receipts.csv, then matched to the statement line it paid for. A match is evidence
 * for a category (what was bought), never required.
 *
 * Usage: bun receipts.ts add <file> --date YYYY-MM-DD --merchant <name> --amount N --currency CUR
 *                        [--items <what was bought>] [--entity <slug>]
 *        bun receipts.ts match            links each receipt with exactly one fitting line
 *        bun receipts.ts link <receipt> <line>   records a match the operator confirmed
 */

const HEADER = 'id,date,merchant,amount,currency,items,entity,file,line';

const row = (r: Receipt): string =>
  csvLine([r.id, r.date, r.merchant, r.amount, r.currency, r.items, r.entity, r.file, r.line]);

const write = (dir: string, receipts: Receipt[]): void => {
  mkdirSync(dirname(DATA.receipts(dir)), { recursive: true });
  writeFileSync(DATA.receipts(dir), `${[HEADER, ...receipts.map(row)].join('\n')}\n`);
};

export interface NewReceipt {
  file: string;
  date: string;
  merchant: string;
  amount: number;
  currency: string;
  items?: string;
  entity: string;
}

/**
 * Files a receipt and records it. The same file twice is recorded once. A file in the inbox is
 * moved; one anywhere else is copied, its original left where it was.
 */
export const addReceipt = (dir: string, input: NewReceipt): { receipt: Receipt; added: boolean } => {
  const id = hashBuffer(readFileSync(input.file));
  const existing = loadReceipts(dir).find((receipt) => receipt.id === id);
  if (existing !== undefined) {
    return { receipt: existing, added: false };
  }
  const target = join(
    dir,
    'data',
    'receipts',
    input.entity,
    monthOf(input.date),
    `${input.date} ${slugify(input.merchant)} ${input.amount} ${input.currency}${extname(input.file).toLowerCase()}`
  );
  mkdirSync(dirname(target), { recursive: true });
  if (relative(DATA.inbox(dir), input.file).startsWith('..')) {
    copyFileSync(input.file, target);
  } else {
    renameSync(input.file, target);
  }
  const receipt: Receipt = { id, ...input, items: input.items ?? '', file: relative(dir, target), line: '' };
  if (!existsSync(DATA.receipts(dir))) {
    write(dir, []);
  }
  appendFileSync(DATA.receipts(dir), `${row(receipt)}\n`);
  return { receipt, added: true };
};

const words = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3)
  );

export interface MatchReport {
  matched: { receipt: string; line: string }[];
  ambiguous: { receipt: string; lines: string[] }[];
  unmatched: string[];
}

/**
 * Links each unlinked receipt to the one line it fits: the same currency and amount, a line dated
 * from a day before the receipt to five days after, and a word of the merchant in the line's text.
 * None, or several, are left for the agent to ask about, as are two receipts that fit the same line.
 */
export const matchReceipts = (dir: string, today: string): MatchReport => {
  const receipts = loadReceipts(dir);
  const input = loadFinance(dir, today);
  const lines = classifyAll(input.txns, input.rules, input.entities).filter((line) => line.amount < 0);
  const taken = new Set(receipts.map((receipt) => receipt.line).filter((line) => line !== ''));
  const fits = (receipt: Receipt) => {
    const merchant = words(receipt.merchant);
    return lines.filter(
      (line) =>
        !taken.has(line.id) &&
        line.currency === receipt.currency &&
        cents(-line.amount) === cents(receipt.amount) &&
        daysBetween(receipt.date, line.date) >= -1 &&
        daysBetween(receipt.date, line.date) <= 5 &&
        [...words(`${line.payee} ${line.raw}`)].some((word) => merchant.has(word))
    );
  };
  const results = receipts
    .filter((receipt) => receipt.line === '')
    .map((receipt) => ({ receipt, candidates: fits(receipt) }));
  const sole = results.flatMap(({ receipt, candidates }) =>
    candidates.length === 1 && candidates[0] !== undefined ? [{ receipt: receipt.id, line: candidates[0].id }] : []
  );
  const wanted = Map.groupBy(sole, (match) => match.line);
  const matched = sole.filter((match) => wanted.get(match.line)?.length === 1);
  const contested = sole.filter((match) => !matched.includes(match));
  if (matched.length > 0) {
    const byReceipt = new Map(matched.map((match) => [match.receipt, match.line]));
    write(
      dir,
      receipts.map((receipt) => ({ ...receipt, line: byReceipt.get(receipt.id) ?? receipt.line }))
    );
  }
  return {
    matched,
    ambiguous: [
      ...results
        .filter(({ candidates }) => candidates.length > 1)
        .map(({ receipt, candidates }) => ({ receipt: receipt.id, lines: candidates.map((line) => line.id) })),
      ...contested.map((match) => ({ receipt: match.receipt, lines: [match.line] }))
    ],
    unmatched: results.filter(({ candidates }) => candidates.length === 0).map(({ receipt }) => receipt.id)
  };
};

/** Records a match the operator confirmed; refuses a receipt or line that doesn't exist. */
export const linkReceipt = (dir: string, receiptId: string, lineId: string, today: string): void => {
  const receipts = loadReceipts(dir);
  const input = loadFinance(dir, today);
  if (!receipts.some((receipt) => receipt.id === receiptId)) {
    throw new Error(`no receipt ${receiptId}`);
  }
  if (!input.txns.some((txn) => txn.id === lineId)) {
    throw new Error(`no line ${lineId}`);
  }
  write(
    dir,
    receipts.map((receipt) => (receipt.id === receiptId ? { ...receipt, line: lineId } : receipt))
  );
};

/** The only entity, for a receipt added without --entity; with several, the agent names it. */
const soleEntity = (dir: string): string => {
  const entities = loadEntities(dir);
  const only = entities.length === 1 ? entities[0] : undefined;
  if (only === undefined) {
    throw new Error('name the --entity this receipt belongs to');
  }
  return only.slug;
};

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  const dir = argValue(rest, '--dir') ?? join(FOLDERS.PROJECTS, 'finances');
  const today = argValue(rest, '--today') ?? todayDate();
  const positional = positionals(rest);
  try {
    if (command === 'add' && positional[0] !== undefined) {
      const amount = Number(argValue(rest, '--amount'));
      const date = argValue(rest, '--date') ?? '';
      const merchant = argValue(rest, '--merchant') ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || merchant === '' || !Number.isFinite(amount)) {
        throw new Error('add needs --date YYYY-MM-DD, --merchant and --amount');
      }
      const entity = argValue(rest, '--entity') ?? soleEntity(dir);
      console.log(
        JSON.stringify(
          addReceipt(dir, {
            file: positional[0],
            date,
            merchant,
            amount,
            currency: argValue(rest, '--currency') ?? 'MYR',
            items: argValue(rest, '--items'),
            entity
          }),
          null,
          2
        )
      );
    } else if (command === 'match') {
      console.log(JSON.stringify(matchReceipts(dir, today), null, 2));
    } else if (command === 'link' && positional[0] !== undefined && positional[1] !== undefined) {
      linkReceipt(dir, positional[0], positional[1], today);
      console.log(`linked ${positional[0]} to ${positional[1]}`);
    } else {
      console.error(
        'usage: bun receipts.ts <add <file> --date D --merchant M --amount N [--currency C] [--items I] [--entity E] | match | link <receipt> <line>>'
      );
      process.exit(1);
    }
  } catch (error) {
    refuse(error);
  }
}
