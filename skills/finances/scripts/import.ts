#!/usr/bin/env bun
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { FOLDERS } from '../../../src/config';
import { hashBuffer } from '../../../src/knowledge/utils';
import { type Account, argValue, type Entity, escapeRegExp, loadEntities, refuse, yamlBlock } from './calendar';
import { cents, Check, csvFiles, csvLine, DATA, monthOf } from './layout';
import { csvRows, parseCsv } from './liability';

/**
 * Statement importer for the finances skill. Reads one bank, card or platform export (CSV or XLSX
 * through the institution's column map in importers/<id>.md, or the canonical CSV the agent stages
 * from a PDF), proves it against its own balances, and appends its transactions under data/. The
 * original is filed under data/originals/, and the tax ledger gets the `statement` row the books
 * read, once per account and month. Importing the same file, or an overlapping export, adds nothing.
 *
 * Usage: bun import.ts <file> --account <id> [--original <file>] [--opening N] [--closing N]
 *                      [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--due YYYY-MM-DD] [--amount-due N]
 *                      [--sheet N] [--dir <finances dir>] [--dry-run]
 *        Prints the import report as JSON; exits 1 with the reason when the file is refused.
 */

export interface Importer {
  id: string;
  date: string;
  dateFormat: string;
  description: string[];
  amount?: string;
  debit?: string;
  credit?: string;
  balance?: string;
  invert: boolean;
}

/** The shape the agent writes when it reads a PDF statement: ISO dates, signed amounts, money out negative. */
export const CANONICAL: Importer = {
  id: 'canonical',
  date: 'date',
  dateFormat: 'YYYY-MM-DD',
  description: ['description'],
  amount: 'amount',
  balance: 'balance',
  invert: false
};

export interface StatementLine {
  date: string;
  amount: number;
  raw: string;
  balance: number | null;
}

const TRANSACTIONS_HEADER = 'id,date,account,amount,currency,balance,raw,source';
const STATEMENTS_HEADER = 'account,period_start,period_end,opening,closing,currency,due_date,amount_due,check,file,sha';
const LEDGER_HEADER =
  'date,type,counterparty,country,currency,amount,amount_myr,tax,reference,category,file,flags,notes';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A money cell as a signed number, or null when blank. Reads thousands commas, a currency code or
 * symbol, a leading or trailing minus, parentheses, and a DR/CR suffix (DR is money out).
 */
export const parseMoney = (text: string): number | null => {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '-') {
    return null;
  }
  const debit = /\bDR$/i.test(trimmed);
  const negative = debit || /^\(.*\)$/.test(trimmed) || /^[^0-9]*-/.test(trimmed) || /-$/.test(trimmed);
  const digits = trimmed.replace(/\b(DR|CR)$/i, '').replace(/[^0-9.]/g, '');
  const value = Number(digits);
  if (digits === '' || !Number.isFinite(value)) {
    throw new Error(`"${text}" is not an amount`);
  }
  return negative ? -value : value;
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** An Excel serial day (1900 system) as an ISO date. */
const fromSerial = (serial: number): string =>
  new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);

/**
 * A date cell in the importer's format (`DD/MM/YYYY`, `D MMM YYYY`, `YYYY-MM-DD`, ...) as an ISO
 * date. A time after the date is ignored; an XLSX serial number is read as one.
 */
export const parseDate = (text: string, format: string): string => {
  const trimmed = text.trim();
  if (/^\d{5}(\.\d+)?$/.test(trimmed)) {
    return fromSerial(Number(trimmed));
  }
  const tokens = format.match(/YYYY|YY|MMM|MM|M|DD|D|[^YMD]+/g) ?? [];
  const pattern = tokens
    .map(
      (token) =>
        ({
          YYYY: '(\\d{4})',
          YY: '(\\d{2})',
          MMM: '([A-Za-z]{3})[A-Za-z]*',
          MM: '(\\d{2})',
          M: '(\\d{1,2})',
          DD: '(\\d{2})',
          D: '(\\d{1,2})'
        })[token] ?? escapeRegExp(token)
    )
    .join('');
  const match = new RegExp(`^${pattern}`).exec(trimmed);
  if (match === null) {
    throw new Error(`"${text}" does not match the date format ${format}`);
  }
  const parts = tokens.filter((token) => /^(YYYY|YY|MMM|MM|M|DD|D)$/.test(token));
  const value = (names: string[]): string => match[parts.findIndex((part) => names.includes(part)) + 1] ?? '';
  const yearText = value(['YYYY', 'YY']);
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  const monthText = value(['MMM', 'MM', 'M']);
  const month = /^\d+$/.test(monthText) ? Number(monthText) : MONTHS.indexOf(monthText.toLowerCase()) + 1;
  const day = Number(value(['DD', 'D']));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`"${text}" is not a real date in the format ${format}`);
  }
  return `${year}-${pad(month)}-${pad(day)}`;
};

const asList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return typeof value === 'string' ? [value] : [];
};

const optional = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
 * Reads `importers/<id>.md`: the column map lives in the yaml block under `## Columns`.
 */
export const parseImporter = (id: string, raw: string): Importer => {
  const map = yamlBlock(raw, 'Columns');
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`importers/${id}.md needs a yaml block under ## Columns`);
  }
  const fields = map as Record<string, unknown>;
  const importer: Importer = {
    id,
    date: optional(fields.date) ?? '',
    dateFormat: optional(fields.date_format) ?? '',
    description: asList(fields.description),
    amount: optional(fields.amount),
    debit: optional(fields.debit),
    credit: optional(fields.credit),
    balance: optional(fields.balance),
    invert: fields.invert === true
  };
  if (importer.date === '' || importer.dateFormat === '' || importer.description.length === 0) {
    throw new Error(`importers/${id}.md: ## Columns needs date, date_format and description`);
  }
  if (importer.amount === undefined && importer.debit === undefined && importer.credit === undefined) {
    throw new Error(`importers/${id}.md: ## Columns needs amount, or debit and credit`);
  }
  return importer;
};

const columnsOf = (importer: Importer): string[] =>
  [importer.date, ...importer.description, importer.amount, importer.debit, importer.credit, importer.balance].filter(
    (column): column is string => column !== undefined
  );

const normalizeHeader = (cell: string): string => cell.trim().toLowerCase();

/**
 * The statement's lines, oldest first, from its rows. The header is the first row holding every
 * column the importer names, so a bank's preamble above it is skipped; rows without a date below it
 * (subtotals, footers) are dropped.
 */
export const readLines = (rows: string[][], importer: Importer): StatementLine[] => {
  const wanted = columnsOf(importer).map(normalizeHeader);
  const headerAt = rows.findIndex((row) => wanted.every((column) => row.map(normalizeHeader).includes(column)));
  if (headerAt === -1) {
    throw new Error(`no row holds all of the ${importer.id} importer's columns (${columnsOf(importer).join(', ')})`);
  }
  const header = rows[headerAt]?.map(normalizeHeader) ?? [];
  const cell = (row: string[], column: string | undefined): string =>
    column === undefined ? '' : (row[header.indexOf(normalizeHeader(column))] ?? '').trim();
  const lines = rows.slice(headerAt + 1).flatMap((row, i): StatementLine[] => {
    const dateText = cell(row, importer.date);
    if (dateText === '') {
      return [];
    }
    try {
      const sign = importer.invert ? -1 : 1;
      const signed =
        importer.amount !== undefined
          ? (parseMoney(cell(row, importer.amount)) ?? 0)
          : (parseMoney(cell(row, importer.credit)) ?? 0) - Math.abs(parseMoney(cell(row, importer.debit)) ?? 0);
      const balanceText = cell(row, importer.balance);
      return [
        {
          date: parseDate(dateText, importer.dateFormat),
          amount: sign * signed,
          raw: importer.description
            .map((column) => cell(row, column))
            .filter((text) => text !== '')
            .join(' ')
            .replace(/\s+/g, ' '),
          balance: balanceText === '' ? null : sign * (parseMoney(balanceText) ?? 0)
        }
      ];
    } catch (error) {
      throw new Error(`row ${headerAt + i + 2}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const first = lines[0];
  const last = lines.at(-1);
  return first !== undefined && last !== undefined && first.date > last.date ? lines.toReversed() : lines;
};

export interface Proof {
  check: Check;
  opening: number | null;
  closing: number | null;
}

/**
 * Proves the lines against the statement's own balances: every running balance follows from the one
 * before it, and the opening plus the lines makes the closing. Either side may come from the
 * statement's printed figures (given) or its balance column. Throws on the first line that breaks;
 * a statement with no balances at all comes back unchecked.
 */
export const prove = (lines: StatementLine[], given: { opening: number | null; closing: number | null }): Proof => {
  const first = lines[0];
  const last = lines.at(-1);
  const opening =
    given.opening ?? (first !== undefined && first.balance !== null ? cents(first.balance - first.amount) / 100 : null);
  const closing = given.closing ?? last?.balance ?? null;
  lines.reduce<number | null>((before, line, i) => {
    if (before !== null && line.balance !== null && cents(before + line.amount) !== cents(line.balance)) {
      throw new Error(
        `line ${i + 1} (${line.date}, ${line.raw}): the balance ${line.balance} does not follow from ${before} and ${line.amount}`
      );
    }
    return line.balance ?? (before === null ? null : before + line.amount);
  }, opening);
  if (opening === null || closing === null) {
    return { check: Check.Unchecked, opening, closing };
  }
  const total = lines.reduce((sum, line) => sum + cents(line.amount), 0);
  if (cents(opening) + total !== cents(closing)) {
    throw new Error(`the opening ${opening} plus the lines (${total / 100}) does not make the closing ${closing}`);
  }
  return { check: Check.Checked, opening, closing };
};

/**
 * One id per line: the same account, date, amount and description, counted within the statement, so
 * two identical charges on one day stay two lines and an overlapping export repeats the same ids.
 */
export const lineIds = (account: string, lines: StatementLine[]): string[] => {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const key = `${account}|${line.date}|${cents(line.amount)}|${line.raw}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return hashBuffer(`${key}|${n}`);
  });
};

const decodeXml = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

const unzipEntry = (path: string, entry: string): string => {
  const result = Bun.spawnSync(['unzip', '-p', path, entry]);
  return result.exitCode === 0 ? result.stdout.toString() : '';
};

/** A cell reference's column (`B7` is 1), or -1 when the cell has none and follows the one before it. */
const columnIndex = (ref: string): number =>
  [...ref].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;

const texts = (xml: string): string =>
  [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1] ?? '')).join('');

/**
 * The cells of one sheet of an XLSX workbook (1 is the first), read from its XML with the system
 * `unzip`. Shared and inline strings are resolved; numbers stay as written, dates as serial days.
 */
export const readXlsx = (path: string, sheet = 1): string[][] => {
  const xml = unzipEntry(path, `xl/worksheets/sheet${sheet}.xml`);
  if (xml === '') {
    throw new Error(`${basename(path)} has no sheet ${sheet}`);
  }
  const shared = [...unzipEntry(path, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    texts(match[1] ?? '')
  );
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)]
    .map((row) =>
      [...(row[1] ?? '').matchAll(/<c(?:\s([^>]*?))?(?:\/>|>([\s\S]*?)<\/c>)/g)].reduce<string[]>((cells, cell) => {
        const attributes = cell[1] ?? '';
        const inner = cell[2] ?? '';
        const type = attributes.match(/\bt="([^"]+)"/)?.[1];
        const value = decodeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
        const text = type === 's' ? (shared[Number(value)] ?? '') : type === 'inlineStr' ? texts(inner) : value;
        const index = columnIndex(attributes.match(/\br="([A-Z]+)\d+"/)?.[1] ?? '');
        const filled =
          cells.length > index ? cells : [...cells, ...Array.from({ length: index - cells.length }, () => '')];
        return index >= 0 ? [...filled.slice(0, index), text, ...filled.slice(index + 1)] : [...filled, text];
      }, [])
    )
    .filter((cells) => cells.some((cell) => cell.trim() !== ''));
};

const appendRows = (path: string, header: string, lines: string[]): void => {
  if (lines.length === 0) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, `${header}\n`);
  }
  appendFileSync(path, lines.map((line) => `${line}\n`).join(''));
};

export interface Located {
  account: Account;
  entity: Entity;
}

/** Finds an account by id across every profile; an id listed under two entities stops the run. */
export const locate = (entities: Entity[], id: string): Located => {
  const found = entities.flatMap((entity) =>
    entity.accounts.filter((account) => account.id === id).map((account) => ({ account, entity }))
  );
  if (found.length > 1) {
    throw new Error(
      `account ${id} is listed under ${found.map((hit) => hit.entity.slug).join(' and ')}: account ids must be unique across entities`
    );
  }
  const hit = found[0];
  if (hit === undefined) {
    throw new Error(`no account ${id} under ## Accounts in any entity profile: add it there first`);
  }
  return hit;
};

const importerFor = (dir: string, account: Account, file: string, rows: string[][]): Importer => {
  if (
    extname(file).toLowerCase() === '.csv' &&
    rows[0]?.map(normalizeHeader).join(',').startsWith('date,description,amount')
  ) {
    return CANONICAL;
  }
  const id = account.importer ?? account.institution;
  const path = id === undefined ? '' : join(dir, 'importers', `${id}.md`);
  if (id === undefined || !existsSync(path)) {
    throw new Error(
      `no importer for account ${account.id}: write importers/<id>.md and set importer: <id> on the account`
    );
  }
  return parseImporter(id, readFileSync(path, 'utf8'));
};

export interface ImportOptions {
  dir: string;
  file: string;
  account: string;
  original?: string;
  opening?: number;
  closing?: number;
  from?: string;
  to?: string;
  due?: string;
  amountDue?: number;
  sheet?: number;
  dryRun?: boolean;
}

export interface ImportReport {
  account: string;
  entity: string;
  from: string;
  to: string;
  check: Check;
  opening: number | null;
  closing: number | null;
  lines: number;
  added: number;
  repeated: number;
  filed: string | null;
  ledger: 'added' | 'present';
  /** The unproven import of the same period this one replaced, by its filed path. */
  replaced: string | null;
  alreadyImported: boolean;
  dryRun: boolean;
}

const isInside = (dir: string, path: string): boolean => !relative(dir, path).startsWith('..');

interface Planned {
  report: ImportReport;
  rows: { year: string; line: string }[];
  statement: string;
  ledger: { path: string; line: string } | null;
  original: string;
  filed: string | null;
  staged: string | null;
}

const readRows = (path: string): Record<string, string>[] =>
  existsSync(path) ? parseCsv(readFileSync(path, 'utf8')) : [];

/** Everything one import would write, worked out before anything is written. */
const planImport = (options: ImportOptions): Planned => {
  const { dir } = options;
  const { account, entity } = locate(loadEntities(dir), options.account);
  const original = options.original ?? options.file;
  const sha = hashBuffer(readFileSync(original));
  const rows =
    extname(options.file).toLowerCase() === '.xlsx'
      ? readXlsx(options.file, options.sheet)
      : csvRows(readFileSync(options.file, 'utf8'));
  const lines = readLines(rows, importerFor(dir, account, options.file, rows));
  if (lines.length === 0 && (options.from === undefined || options.to === undefined)) {
    throw new Error('the statement has no lines: give --from and --to to record an empty month');
  }
  const proof = prove(lines, { opening: options.opening ?? null, closing: options.closing ?? null });
  const from = options.from ?? lines[0]?.date ?? '';
  const to = options.to ?? lines.at(-1)?.date ?? '';
  const currency = account.currency ?? entity.currency;
  const statements = readRows(DATA.statements(dir));
  const samePeriod = statements.find(
    (row) => row.account === account.id && row.period_start === from && row.period_end === to
  );
  const replaced =
    samePeriod !== undefined && samePeriod.check !== Check.Checked && proof.check === Check.Checked
      ? (samePeriod.file ?? null)
      : null;
  const alreadyImported = statements.some((row) => row.sha === sha) || (samePeriod !== undefined && replaced === null);
  const known = new Set(
    csvFiles(DATA.transactions(dir, entity.slug)).flatMap((path) =>
      readRows(path)
        .filter((row) => replaced === null || row.source !== replaced)
        .map((row) => row.id)
    )
  );
  const ids = lineIds(account.id, lines);
  const fresh = alreadyImported
    ? []
    : lines.map((line, i) => ({ line, id: ids[i] ?? '' })).filter(({ id }) => !known.has(id));
  const ledgerPath = DATA.ledger(dir, entity.slug, to.slice(0, 4));
  const ledgerHas = readRows(ledgerPath).some(
    (row) =>
      row.type === 'statement' &&
      row.category === account.id &&
      monthOf(row.date ?? '') === monthOf(to) &&
      (replaced === null || row.file !== replaced)
  );
  const target = join(
    DATA.originals(dir, entity.slug, monthOf(to)),
    `${to} ${account.id} statement${extname(original).toLowerCase()}`
  );
  const filed = alreadyImported
    ? null
    : existsSync(target)
      ? target.replace(/(\.[^.]+)$/, ` ${sha.slice(0, 6)}$1`)
      : target;
  const source = relative(dir, filed ?? target);
  return {
    report: {
      account: account.id,
      entity: entity.slug,
      from,
      to,
      check: proof.check,
      opening: proof.opening,
      closing: proof.closing,
      lines: lines.length,
      added: fresh.length,
      repeated: lines.length - fresh.length,
      filed: filed === null ? null : relative(dir, filed),
      ledger: ledgerHas || alreadyImported ? 'present' : 'added',
      replaced,
      alreadyImported,
      dryRun: options.dryRun === true
    },
    rows: fresh.map(({ line, id }) => ({
      year: line.date.slice(0, 4),
      line: csvLine([id, line.date, account.id, line.amount, currency, line.balance, line.raw, source])
    })),
    statement: csvLine([
      account.id,
      from,
      to,
      proof.opening,
      proof.closing,
      currency,
      options.due ?? null,
      options.amountDue ?? null,
      proof.check,
      source,
      sha
    ]),
    ledger:
      ledgerHas || alreadyImported
        ? null
        : {
            path: ledgerPath,
            line: csvLine([
              to,
              'statement',
              account.name,
              null,
              currency,
              proof.closing ?? 0,
              null,
              0,
              `${from} to ${to}`,
              account.id,
              source,
              null,
              'imported'
            ])
          },
    original,
    filed,
    staged: options.original === undefined ? null : options.file
  };
};

/** Rewrites a CSV without the rows an earlier import of `file` wrote to it. */
const dropRows = (path: string, header: string, column: string, file: string): void => {
  const rows = readRows(path);
  const kept = rows.filter((row) => row[column] !== file);
  if (kept.length < rows.length) {
    const columns = header.split(',');
    writeFileSync(
      path,
      [header, ...kept.map((row) => csvLine(columns.map((key) => row[key] ?? null)))].join('\n') + '\n'
    );
  }
};

const writeImport = (dir: string, plan: Planned): void => {
  const entity = plan.report.entity;
  const replaced = plan.report.replaced;
  if (plan.filed !== null) {
    mkdirSync(dirname(plan.filed), { recursive: true });
    if (isInside(DATA.inbox(dir), plan.original)) {
      renameSync(plan.original, plan.filed);
    } else {
      copyFileSync(plan.original, plan.filed);
    }
  }
  if (replaced !== null) {
    csvFiles(DATA.transactions(dir, entity)).forEach((path) => dropRows(path, TRANSACTIONS_HEADER, 'source', replaced));
    dropRows(DATA.statements(dir), STATEMENTS_HEADER, 'file', replaced);
    if (plan.ledger !== null) {
      dropRows(plan.ledger.path, LEDGER_HEADER, 'file', replaced);
    }
  }
  Map.groupBy(plan.rows, (row) => row.year).forEach((rows, year) =>
    appendRows(
      join(DATA.transactions(dir, entity), `${year}.csv`),
      TRANSACTIONS_HEADER,
      rows.map((row) => row.line)
    )
  );
  if (plan.ledger !== null) {
    appendRows(plan.ledger.path, LEDGER_HEADER, [plan.ledger.line]);
  }
  // Last: a retry reads the statement row as the import being complete.
  appendRows(DATA.statements(dir), STATEMENTS_HEADER, [plan.statement]);
  if (plan.staged !== null && isInside(DATA.inbox(dir), plan.staged)) {
    rmSync(plan.staged);
  }
};

/**
 * Imports one statement. Every write happens after every check, so a refused file leaves data/
 * exactly as it was; a dry run, or a statement already imported, writes nothing. A proven statement
 * for a period already imported unproven (an export without balances) replaces that import's lines.
 */
export const importStatement = (options: ImportOptions): ImportReport => {
  const plan = planImport(options);
  if (options.dryRun !== true && !plan.report.alreadyImported) {
    writeImport(options.dir, plan);
  }
  return plan.report;
};

const numberArg = (args: string[], flag: string): number | undefined => {
  const value = argValue(args, flag);
  return value === undefined ? undefined : (parseMoney(value) ?? undefined);
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args[0];
  const account = argValue(args, '--account');
  if (file === undefined || file.startsWith('--') || account === undefined) {
    console.error(
      'usage: bun import.ts <file> --account <id> [--original <file>] [--opening N] [--closing N] [--from D] [--to D] [--dry-run]'
    );
    process.exit(1);
  }
  try {
    const report = importStatement({
      dir: argValue(args, '--dir') ?? join(FOLDERS.PROJECTS, 'finances'),
      file,
      account,
      original: argValue(args, '--original'),
      opening: numberArg(args, '--opening'),
      closing: numberArg(args, '--closing'),
      from: argValue(args, '--from'),
      to: argValue(args, '--to'),
      due: argValue(args, '--due'),
      amountDue: numberArg(args, '--amount-due'),
      sheet: argValue(args, '--sheet') === undefined ? undefined : Number(argValue(args, '--sheet')),
      dryRun: args.includes('--dry-run')
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    refuse(error);
  }
}
