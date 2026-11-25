#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '../../../src/config';
import { todayDate } from '../../../src/shared/date';
import { classifyAll, learnedRules, loadFinance, type Rule, ruleKey } from './build';
import { argValue } from './calendar';
import { DATA } from './layout';

/**
 * Writes the operator's decisions from the dashboard into RULES.md's `## Learned` blocks: an approval
 * confirms a rule, a fix by payee teaches every line from that payee, a fix for one line names it by
 * id. The prose above `## Learned` is never touched, and applying the same edits twice changes nothing.
 *
 * Usage: bun rules.ts apply [file]   the pasted `finances-edits` block, from the file or stdin
 *        bun rules.ts init           writes RULES.md from the template when the project has none
 */

const TEMPLATE = join(import.meta.dir, '..', 'references', 'rules-template.md');
const FIELDS = ['match', 'payee', 'account', 'date', 'id', 'category', 'for', 'confirmed'] as const;

export const Scope = { Payee: 'payee', Line: 'line' } as const;
export type Scope = (typeof Scope)[keyof typeof Scope];

export interface Fix {
  line: string;
  category: string;
  for?: string;
  scope: Scope;
}

export interface Edits {
  approve: string[];
  set: Fix[];
}

export interface ApplyReport {
  approved: number;
  set: number;
  unknown: string[];
  changed: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isFix = (value: unknown): value is Fix =>
  isRecord(value) &&
  typeof value.line === 'string' &&
  typeof value.category === 'string' &&
  value.category.trim() !== '' &&
  (value.for === undefined || typeof value.for === 'string') &&
  (value.scope === Scope.Payee || value.scope === Scope.Line);

/**
 * The edits in a pasted block: the JSON inside a ```finances-edits fence, or the text itself when
 * it is the JSON alone.
 */
export const parseEdits = (text: string): Edits => {
  const fenced = /```finances-edits\s*\n([\s\S]*?)\n```/.exec(text)?.[1] ?? text;
  const parsed: unknown = JSON.parse(fenced.trim());
  if (!isRecord(parsed) || parsed.v !== 1) {
    throw new Error('not a finances-edits block (version 1)');
  }
  const approve = Array.isArray(parsed.approve) ? parsed.approve : [];
  const set = Array.isArray(parsed.set) ? parsed.set : [];
  const badSet = set.find((fix) => !isFix(fix));
  if (approve.some((key) => typeof key !== 'string') || badSet !== undefined) {
    throw new Error(`a malformed edit: ${JSON.stringify(badSet ?? approve)}`);
  }
  return { approve: approve.filter((key): key is string => typeof key === 'string'), set: set.filter(isFix) };
};

const yamlValue = (value: string | boolean): string =>
  typeof value === 'boolean' ? String(value) : JSON.stringify(value);

/** One rule as a flow-style yaml line, its fields in a fixed order so a rewrite is stable. */
export const ruleLine = (rule: Rule): string =>
  `- { ${FIELDS.flatMap((field) => {
    const value = rule[field];
    return value === undefined ? [] : [`${field}: ${yamlValue(value)}`];
  }).join(', ')} }`;

const block = (rules: Rule[]): string =>
  rules.length === 0 ? '```yaml\n[]\n```' : `\`\`\`yaml\n${rules.map(ruleLine).join('\n')}\n\`\`\``;

/**
 * The text with the yaml blocks under `### Payees` and `### Categories` of `## Learned` replaced, and
 * everything else as it was; a file without the section gets one at its end.
 */
export const withLearned = (text: string, payees: Rule[], categories: Rule[]): string => {
  const start = text.search(/^## Learned[ \t]*$/m);
  if (start === -1) {
    return `${text.trimEnd()}\n\n## Learned\n\n### Payees\n\n${block(payees)}\n\n### Categories\n\n${block(categories)}\n`;
  }
  const after = text.slice(start + 1).search(/^## /m);
  const end = after === -1 ? text.length : start + 1 + after;
  const swap = (section: string, heading: string, rules: Rule[]): string => {
    const pattern = new RegExp(
      `(^### ${heading}[ \\t]*\\r?\\n(?:(?!^#{2,3} )[\\s\\S])*?)\`\`\`ya?ml\\r?\\n[\\s\\S]*?\`\`\``,
      'm'
    );
    return pattern.test(section)
      ? section.replace(pattern, (_whole, prefix: string) => `${prefix}${block(rules)}`)
      : `${section.trimEnd()}\n\n### ${heading}\n\n${block(rules)}\n`;
  };
  const learned = swap(swap(text.slice(start, end), 'Payees', payees), 'Categories', categories);
  const tail = text.slice(end);
  return `${text.slice(0, start)}${learned.trimEnd()}\n${tail === '' ? '' : `\n${tail}`}`;
};

const samePayee = (rule: Rule, payee: string): boolean =>
  rule.payee !== undefined &&
  rule.payee.toLowerCase() === payee.toLowerCase() &&
  rule.id === undefined &&
  rule.account === undefined &&
  rule.date === undefined &&
  rule.match === undefined;

/** RULES.md as it is, or the template when the project has none yet. */
export const readRules = (dir: string): string =>
  readFileSync(existsSync(DATA.rules(dir)) ? DATA.rules(dir) : TEMPLATE, 'utf8');

/**
 * Applies the edits to RULES.md. Approvals confirm the rule with that key. A fix replaces the rules it
 * overrides (the same payee's, or the same line's) and goes first, so the newest decision wins.
 */
export const applyEdits = (dir: string, edits: Edits, today: string): ApplyReport => {
  const text = readRules(dir);
  const { payees, categories } = learnedRules(text);
  const input = loadFinance(dir, today);
  const lines = new Map(classifyAll(input.txns, input.rules, input.entities).map((line) => [line.id, line]));
  const entities = new Set(input.entities.map((entity) => entity.slug));
  const keys = new Set(categories.map(ruleKey));
  const unknownKeys = edits.approve.filter((key) => !keys.has(key));
  const approved = categories.map((rule) =>
    edits.approve.includes(ruleKey(rule)) ? { ...rule, confirmed: true } : rule
  );
  const usable = edits.set.filter((fix) => lines.has(fix.line) && (fix.for === undefined || entities.has(fix.for)));
  const unknownFixes = edits.set
    .filter((fix) => !usable.includes(fix))
    .map((fix) => (lines.has(fix.line) ? `for: ${fix.for ?? ''}` : `line ${fix.line}`));
  const fixed = usable.reduce((rules, fix) => {
    const line = lines.get(fix.line);
    if (line === undefined) {
      return rules;
    }
    const target = fix.scope === Scope.Line ? { id: line.id } : { payee: line.payee };
    const rule: Rule = {
      ...target,
      category: fix.category,
      ...(fix.for === undefined ? {} : { for: fix.for }),
      confirmed: true
    };
    const overridden = (other: Rule): boolean =>
      fix.scope === Scope.Line ? other.id === line.id : samePayee(other, line.payee);
    return [rule, ...rules.filter((other) => !overridden(other))];
  }, approved);
  const next = withLearned(text, payees, fixed);
  const changed = next !== text || !existsSync(DATA.rules(dir));
  if (changed) {
    writeFileSync(DATA.rules(dir), next);
  }
  return {
    approved: edits.approve.length - unknownKeys.length,
    set: usable.length,
    unknown: [...unknownKeys.map((key) => `rule ${key}`), ...unknownFixes],
    changed
  };
};

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  const dir = argValue(rest, '--dir') ?? join(FOLDERS.PROJECTS, 'finances');
  if (command === 'init') {
    if (!existsSync(DATA.rules(dir))) {
      writeFileSync(DATA.rules(dir), readFileSync(TEMPLATE, 'utf8'));
    }
    console.log(DATA.rules(dir));
  } else if (command === 'apply') {
    const file = rest.find((arg, i) => !arg.startsWith('--') && !rest[i - 1]?.startsWith('--'));
    const text = file === undefined ? await Bun.stdin.text() : readFileSync(file, 'utf8');
    try {
      console.log(JSON.stringify(applyEdits(dir, parseEdits(text), argValue(rest, '--today') ?? todayDate()), null, 2));
    } catch (error) {
      console.error(`refused: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  } else {
    console.error('usage: bun rules.ts <apply [file] | init> [--dir <finances dir>]');
    process.exit(1);
  }
}
