#!/usr/bin/env bun
/**
 * The check a moved home runs once, in its first session: reads the change list the previous
 * plugin's move saved (`migratedFrom.log` in `.state/version.json`) and prints what a person should
 * look at. Flagged are the renames most likely wrong (a line naming a login the settings still use,
 * a line in a document as sent or signed) and machine files still naming the old home; the other renames
 * are listed for a read for meaning.
 * Read-only, unless `--restore` puts a rename's original text back. The old plugin's name, home and
 * logins all come from the log, never from this file.
 *
 * Usage: move-check.ts --home <dir> [--restore <path:line>]...
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { RUNTIME_DIR } from '../../../src/shared/naming';

interface Rename {
  path: string;
  line: number;
  before: string;
  after: string;
}
interface MoveLog {
  persona?: Rename[];
  product?: Rename[];
  leftovers?: string[];
}

const args = process.argv.slice(2);
const home = args[args.indexOf('--home') + 1];
if (!args.includes('--home') || !home) {
  process.stderr.write('usage: move-check.ts --home <dir> [--restore <path:line>]...\n');
  process.exit(2);
}
const homeDir = resolve(home);
const restores = args.flatMap((arg, index) => (args[index - 1] === '--restore' ? [arg] : []));

const readJson = (path: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const moved = readJson(join(homeDir, RUNTIME_DIR, 'version.json'))?.migratedFrom as Record<string, unknown> | undefined;
const logPath = typeof moved?.log === 'string' ? resolve(homeDir, moved.log) : null;
const log = logPath ? (readJson(logPath) as MoveLog | null) : null;
if (!logPath || !log) {
  process.stdout.write(
    `${JSON.stringify({ log: null, reason: 'this home was moved without a change list, or was not moved' })}\n`
  );
  process.exit(0);
}
const oldHome = typeof moved?.home === 'string' ? moved.home : '';
const renames = [...(log.persona ?? []), ...(log.product ?? [])];
const key = (rename: Rename): string => `${rename.path}:${rename.line}`;

/** The line a rename wrote, found where the move left it or, after edits shifted it, as the file's only such line. */
const locate = (lines: string[], rename: Rename): number => {
  if (lines[rename.line - 1]?.trim() === rename.after) {
    return rename.line - 1;
  }
  const matches = lines.flatMap((line, index) => (line.trim() === rename.after ? [index] : []));
  return matches.length === 1 ? matches[0] : -1;
};

if (restores.length > 0) {
  const outcome = restores.map((wanted) => {
    const rename = renames.find((candidate) => key(candidate) === wanted);
    const file = rename ? join(homeDir, rename.path) : '';
    if (!rename || !existsSync(file)) {
      return { line: wanted, restored: false, reason: 'not a rename the move made' };
    }
    const text = readFileSync(file, 'utf-8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const at = locate(lines, rename);
    if (at === -1) {
      const reason = lines.some((line) => line.trim() === rename.before)
        ? 'already restored'
        : 'changed since the move; left alone';
      return { line: wanted, restored: false, reason };
    }
    lines[at] = `${lines[at].match(/^\s*/)?.[0] ?? ''}${rename.before}`;
    writeFileSync(file, lines.join(eol));
    return { line: wanted, restored: true };
  });
  process.stdout.write(`${JSON.stringify({ restore: outcome }, null, 2)}\n`);
  process.exit(0);
}

const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * A still-used value written as a value (quoted or in backticks) a few words from "user", "login",
 * "account" or "role": the line names the credential, not the product that shares its spelling.
 */
const loginPatterns = (log.leftovers ?? [])
  .map((entry) => entry.slice(entry.lastIndexOf(': ') + 2))
  .filter(Boolean)
  .map((value) => {
    const quoted = `[\`'"]${literal(value)}[\`'"]`;
    const word = '\\b(?:user(?:name)?|login|account|role)\\b';
    return new RegExp(`${word}[^.;\\n]{0,30}${quoted}|${quoted}[^.;\\n]{0,30}${word}`, 'i');
  });
const isLogin = (rename: Rename): boolean =>
  loginPatterns.some((pattern) => pattern.test(rename.before) && !pattern.test(rename.after));
/** A document as it was sent or signed: a contract, an invoice, a filing, a reply. */
const isDocument = (rename: Rename): boolean =>
  /(^|\/)(contracts?|invoices?|receipts?|statements?|filings?)\//i.test(rename.path) ||
  /^(reply|email|letter|message) to /i.test(basename(rename.path));

const fromHome = relative(homedir(), oldHome);
const spellings = oldHome
  ? [
      oldHome,
      ...(!fromHome.startsWith('..') && !isAbsolute(fromHome)
        ? ['~', '$HOME', '${HOME}'].map((prefix) => `${prefix}/${fromHome}`)
        : [])
    ]
  : [];
const MACHINE_FILES = [
  join('.claude', 'settings.json'),
  join('.claude', 'settings.local.json'),
  '.mcp.json',
  join('.codex', 'config.toml'),
  join('.codex', 'hooks.json')
];
const stale = MACHINE_FILES.flatMap((rel) => {
  const text = existsSync(join(homeDir, rel)) ? readFileSync(join(homeDir, rel), 'utf-8') : '';
  const named = spellings.filter((spelling) => text.includes(spelling));
  return named.length > 0 ? [{ file: rel, names: named }] : [];
});

const flagged = renames.flatMap((rename) => {
  const why = [
    ...(isLogin(rename) ? ['names a login the settings still use'] : []),
    ...(isDocument(rename) ? ['a document as sent or signed'] : [])
  ];
  return why.length > 0 ? [{ ...rename, why: why.join('; ') }] : [];
});
const flaggedKeys = new Set(flagged.map(key));
const others = renames
  .filter((rename) => !flaggedKeys.has(key(rename)))
  .map(
    (rename) => `${key(rename)} | ${rename.before.length > 200 ? `${rename.before.slice(0, 200)}…` : rename.before}`
  );

process.stdout.write(
  `${JSON.stringify({ log: logPath, renamed: renames.length, flagged, stale, renames: others }, null, 2)}\n`
);
