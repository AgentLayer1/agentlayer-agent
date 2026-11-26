#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { FOLDERS } from '../../../src/config';
import { isRecord } from '../../../src/shared/json-block';
import { argValue, positionals, refuse, yamlBlock } from './calendar';
import { asList, datePattern, optional, parseDate, parseMoney } from './import';
import { csvLine } from './layout';

/**
 * PDF statements for the finances skill. A statement whose transactions sit under a column header
 * (date, money out, money in, balance) is read from `pdftotext -layout` text through the
 * institution's layout in importers/<id>.md (`## Layout`), and written as the canonical CSV that
 * import.ts proves and files. `--draft` prints the header rows it found and a layout to start from.
 *
 * Usage: bun pdf.ts <pdf> --importer <id> [--dir <finances dir>]
 *        bun pdf.ts <pdf> --draft
 *        Prints a JSON report; exits 1 with the reason when the statement can't be read.
 */

export interface Layout {
  /** The date format at the start of a transaction line, in parseDate's tokens. */
  date: string;
  /** Header labels, as patterns: money out, money in, and the running balance when the statement prints one. */
  debit: string;
  credit: string;
  balance?: string;
  /** Labels of columns that hold a charge on the line (a fee or tax column): their figures are money out. */
  charges: string[];
  opening?: string;
  closing?: string;
  /** Lines that end a transaction's description (page footers, "continued"). */
  end?: string;
}

export interface StatementRow {
  date: string;
  description: string;
  amount: number;
  balance: number | null;
}

export interface ReadStatement {
  rows: StatementRow[];
  opening: number | null;
  closing: number | null;
  /** Transaction lines with no money in or out (a declined card, a note), left out. */
  skipped: string[];
  /** Lines with a figure under a charges column, counted as money out. */
  charged: string[];
}

const MONEY = /(?<![\w.,])(?:[A-Z]{2,3}\s?|\$)?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{1,2}(?!\d)/g;
const MAX_DESCRIPTION_LINES = 4;
const INDENT = 8;
/** How far left of its column's label a figure may start: wide figures overhang a short label. */
const SLACK = 12;

interface Money {
  value: number;
  start: number;
  end: number;
}

const figures = (line: string): Money[] =>
  [...line.matchAll(MONEY)].map((match) => ({
    value: parseMoney(match[0]) ?? 0,
    start: match.index,
    end: match.index + match[0].length
  }));

interface Column {
  name: string;
  label: RegExp;
  required: boolean;
}

interface Header {
  /** Where each column's label ends: right-aligned figures sit closest to it. */
  ends: Record<string, number>;
  /** Where the first money column starts: description text lies to its left. */
  firstMoney: number;
}

const pattern = (source: string): RegExp => new RegExp(source, 'i');

const columnsOf = (layout: Layout): Column[] => [
  { name: 'debit', label: pattern(layout.debit), required: true },
  { name: 'credit', label: pattern(layout.credit), required: true },
  ...(layout.balance === undefined ? [] : [{ name: 'balance', label: pattern(layout.balance), required: true }]),
  ...layout.charges.map((source, i) => ({ name: `charge${i}`, label: pattern(source), required: false }))
];

const headerOf = (line: string, columns: Column[]): Header | null => {
  const found = columns.map((column) => ({ column, match: column.label.exec(line) }));
  if (found.some(({ column, match }) => column.required && match === null)) {
    return null;
  }
  const hits = found.flatMap(({ column, match }) => (match === null ? [] : [{ name: column.name, match }]));
  return {
    ends: Object.fromEntries(hits.map(({ name, match }) => [name, match.index + match[0].length])),
    firstMoney: Math.min(...hits.map(({ match }) => match.index))
  };
};

const nearest = (header: Header, end: number): string =>
  Object.entries(header.ends).reduce(
    (best, [name, at]) => (Math.abs(at - end) < Math.abs((header.ends[best] ?? Infinity) - end) ? name : best),
    Object.keys(header.ends)[0] ?? 'debit'
  );

interface DraftRow extends Omit<StatementRow, 'description'> {
  parts: string[];
}

interface Scan {
  header: Header | null;
  rows: DraftRow[];
  /** The transaction still taking description lines. */
  open: boolean;
  /** The next line's figures already went to a wrapped transaction. */
  skipNext: boolean;
  opening: number | null;
  closing: number | null;
  skipped: string[];
  charged: string[];
}

/** Reads a statement's layout text into rows, money out negative, in the order the statement prints them. */
export const readStatement = (text: string, layout: Layout): ReadStatement => {
  const lines = text.replace(/\f/g, '\n').split('\n');
  const columns = columnsOf(layout);
  const dateAt = new RegExp(`^\\s{0,${INDENT}}(${datePattern(layout.date).pattern})(?=\\s|$)`);
  const endAt = layout.end === undefined ? null : pattern(layout.end);
  const openingAt = layout.opening === undefined ? null : pattern(layout.opening);
  const closingAt = layout.closing === undefined ? null : pattern(layout.closing);
  const scan = lines.reduce<Scan>(
    (state, raw, i) => {
      if (state.skipNext) {
        return { ...state, skipNext: false };
      }
      const header = headerOf(raw, columns);
      if (header !== null) {
        return { ...state, header, open: false };
      }
      const found = figures(raw);
      const last = found.at(-1);
      if (state.opening === null && openingAt?.test(raw) === true && last !== undefined) {
        return { ...state, opening: last.value, open: false };
      }
      if (closingAt?.test(raw) === true && last !== undefined) {
        return { ...state, closing: last.value, open: false };
      }
      if (endAt?.test(raw) === true || state.header === null) {
        return { ...state, open: false };
      }
      const at = state.header;
      const inZone = (money: Money): boolean => money.start >= at.firstMoney - SLACK;
      const dated = dateAt.exec(raw);
      if (dated !== null) {
        const next = lines[i + 1] ?? '';
        const wrapped = !found.some(inZone) && !dateAt.test(next) && figures(next).some(inZone);
        const placed = (wrapped ? figures(next) : found)
          .filter(inZone)
          .map((money) => ({ column: nearest(at, money.end), value: money.value }));
        const valueOf = (column: string): number | null => placed.find((item) => item.column === column)?.value ?? null;
        const date = parseDate(dated[1] ?? '', layout.date);
        const words = `${raw.slice(dated[0].length)} ${wrapped ? next : ''}`
          .replace(MONEY, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const out = valueOf('debit');
        const into = valueOf('credit');
        if (out === null && into === null) {
          return { ...state, skipped: [...state.skipped, `${date} ${words}`], open: false, skipNext: wrapped };
        }
        const charge = placed
          .filter((item) => item.column.startsWith('charge'))
          .reduce((sum, item) => sum + item.value, 0);
        const row: DraftRow = {
          date,
          amount: Math.round(((into ?? 0) - (out ?? 0) - charge) * 100) / 100,
          balance: valueOf('balance'),
          parts: [words]
        };
        return {
          ...state,
          rows: [...state.rows, row],
          charged: charge > 0 ? [...state.charged, `${date} ${words}`] : state.charged,
          open: true,
          skipNext: wrapped
        };
      }
      const current = state.rows.at(-1);
      const indent = raw.length - raw.trimStart().length;
      const describes =
        state.open &&
        current !== undefined &&
        raw.trim() !== '' &&
        indent < at.firstMoney &&
        !found.some(inZone) &&
        current.parts.length < MAX_DESCRIPTION_LINES;
      return describes
        ? {
            ...state,
            rows: state.rows.with(-1, { ...current, parts: [...current.parts, raw.trim().replace(/\s+/g, ' ')] })
          }
        : state;
    },
    { header: null, rows: [], open: false, skipNext: false, opening: null, closing: null, skipped: [], charged: [] }
  );
  const { rows, opening, closing, skipped, charged } = scan;
  return {
    rows: rows.map(({ parts, ...row }) => ({ ...row, description: parts.filter((part) => part !== '').join(' · ') })),
    opening,
    closing,
    skipped,
    charged
  };
};

/** Reads `## Layout` from an importer file. */
export const parseLayout = (id: string, raw: string): Layout => {
  const block = yamlBlock(raw, 'Layout');
  if (!isRecord(block)) {
    throw new Error(`importers/${id}.md needs a yaml block under ## Layout`);
  }
  const columns = isRecord(block.columns) ? block.columns : {};
  const date = optional(block.date);
  const debit = optional(columns.debit);
  const credit = optional(columns.credit);
  if (date === undefined || debit === undefined || credit === undefined) {
    throw new Error(`importers/${id}.md: ## Layout needs date, and columns with debit and credit`);
  }
  return {
    date,
    debit,
    credit,
    balance: optional(columns.balance),
    charges: asList(columns.charges),
    opening: optional(block.opening),
    closing: optional(block.closing),
    end: optional(block.end)
  };
};

const HEADER_WORDS =
  /\b(date|description|details|withdrawal|deposit|debit|credit|balance|money in|money out|amount)\b/gi;
const DATE_SHAPES: [RegExp, string][] = [
  [/^\s*\d{2}\/\d{2}\/\d{4}\b/, 'DD/MM/YYYY'],
  [/^\s*\d{2}-\d{2}-\d{4}\b/, 'DD-MM-YYYY'],
  [/^\s*\d{4}-\d{2}-\d{2}\b/, 'YYYY-MM-DD'],
  [/^\s*\d{2} [A-Za-z]{3} \d{4}\b/, 'DD MMM YYYY'],
  [/^\s*\d{1,2} [A-Za-z]{3} \d{4}\b/, 'D MMM YYYY'],
  [/^\s*\d{1,2}\/\d{1,2}\/\d{4}\b/, 'D/M/YYYY']
];

/** The statement's likely header rows and a layout to start from, for the agent to check and save. */
export const draftLayout = (text: string): { headers: string[]; layout: string } => {
  const lines = text.replace(/\f/g, '\n').split('\n');
  const headers = [
    ...new Set(lines.filter((line) => (line.match(HEADER_WORDS) ?? []).length >= 3).map((line) => line.trim()))
  ];
  const header = headers[0] ?? '';
  const label = (test: RegExp): string | undefined => header.match(test)?.[0];
  const date = DATE_SHAPES.find(([shape]) => lines.some((line) => shape.test(line)))?.[1] ?? 'DD/MM/YYYY';
  const phrase = (test: RegExp): string | undefined =>
    lines
      .find((line) => test.test(line))
      ?.replace(MONEY, '')
      .trim()
      .split(/\s{2,}/)[0];
  const fields: [string, string | undefined][] = [
    ['date', date],
    ['columns', undefined],
    ['  debit', label(/withdrawals?|debits?|money out|paid out/i)],
    ['  credit', label(/deposits?|credits?|money in|paid in/i)],
    ['  balance', label(/balance/i)],
    ['  charges', label(/\b(fees?|tax|charges?)\b/i)],
    ['opening', phrase(/opening balance|balance brought forward|previous balance/i)],
    ['closing', phrase(/closing balance|balance carried forward/i)]
  ];
  const layout = fields
    .filter(([name, value]) => name === 'columns' || value !== undefined)
    .map(([name, value]) => (value === undefined ? `${name}:` : `${name}: ${JSON.stringify(value)}`))
    .join('\n');
  return { headers, layout };
};

const POPPLER =
  'pdftotext was not found. Install poppler (macOS `brew install poppler`, Linux `poppler-utils`, Windows `winget install --id oschwartz10612.Poppler`), then run this again.';

const layoutText = (pdf: string): string => {
  if (Bun.which('pdftotext') === null) {
    throw new Error(POPPLER);
  }
  const run = Bun.spawnSync(['pdftotext', '-layout', pdf, '-']);
  if (!run.success) {
    throw new Error(`pdftotext could not read ${pdf}: ${run.stderr.toString().trim()}`);
  }
  return run.stdout.toString();
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const pdf = positionals(args)[0];
  try {
    if (pdf === undefined || !existsSync(pdf)) {
      throw new Error('usage: bun pdf.ts <pdf> --importer <id> [--dir <finances dir>] | bun pdf.ts <pdf> --draft');
    }
    const statement = layoutText(pdf);
    if (args.includes('--draft')) {
      console.log(JSON.stringify(draftLayout(statement), null, 2));
    } else {
      const id = argValue(args, '--importer');
      const dir = argValue(args, '--dir') ?? join(FOLDERS.PROJECTS, 'finances');
      const file = join(dir, 'importers', `${id ?? ''}.md`);
      if (id === undefined || !existsSync(file)) {
        throw new Error(`no layout at importers/${id ?? '<id>'}.md: run with --draft and save one first`);
      }
      const read = readStatement(statement, parseLayout(id, readFileSync(file, 'utf8')));
      if (read.rows.length === 0) {
        throw new Error('no transaction lines matched the layout: check its date format and column labels');
      }
      const out = join(dir, 'data', 'inbox', '.staged', `${basename(pdf, extname(pdf))}.csv`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(
        out,
        `${[
          ['date', 'description', 'amount', 'balance'],
          ...read.rows.map((row) => [
            row.date,
            row.description,
            row.amount.toFixed(2),
            row.balance === null ? '' : row.balance.toFixed(2)
          ])
        ]
          .map((values) => csvLine(values))
          .join('\n')}\n`
      );
      console.log(
        JSON.stringify(
          {
            staged: out,
            opening: read.opening,
            closing: read.closing,
            lines: read.rows.length,
            skipped: read.skipped,
            charged: read.charged
          },
          null,
          2
        )
      );
    }
  } catch (error) {
    refuse(error);
  }
}
