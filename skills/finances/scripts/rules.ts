#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '../../../src/config';
import { todayDate } from '../../../src/shared/date';
import { isRecord } from '../../../src/shared/json-block';
import { classifyAll, learnedBounds, learnedRules, loadFinance, type Rule, ruleKey } from './build';
import { argValue, positionals, refuse } from './calendar';
import { DATA } from './layout';

/**
 * Writes the operator's decisions from the dashboard into RULES.md's `## Learned` blocks: an approval
 * confirms a rule, a fix by payee teaches every line from that payee, a fix for one line names it by
 * id. The prose above `## Learned` is never touched, and applying the same edits twice changes nothing.
 *
 * Usage: bun rules.ts apply [file]     the pasted `finances-edits` block, from the file or stdin
 *        bun rules.ts review [--limit N] the payees no rule covers, with the confirmed rules as examples
 *        bun rules.ts suggest [file]   adds the agent's suggestions (JSON) as unconfirmed rules
 *        bun rules.ts init             writes RULES.md from the template when the project has none
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
  const bounds = learnedBounds(text);
  if (bounds === null) {
    return `${text.trimEnd()}\n\n## Learned\n\n### Payees\n\n${block(payees)}\n\n### Categories\n\n${block(categories)}\n`;
  }
  const { start, end } = bounds;
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

/** Whether two rules select the same lines: the same pattern, payee, account, date and line, case aside. */
const sameTarget = (a: Rule, b: Rule): boolean =>
  (a.match ?? '').toLowerCase() === (b.match ?? '').toLowerCase() &&
  (a.payee ?? '').toLowerCase() === (b.payee ?? '').toLowerCase() &&
  a.account === b.account &&
  a.date === b.date &&
  a.id === b.id;

/** RULES.md as it is, or the template when the project has none yet. */
const readRules = (dir: string): string =>
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
  const fixed = usable
    .flatMap((fix) => {
      const line = lines.get(fix.line);
      return line === undefined ? [] : [{ fix, line }];
    })
    .reduce((rules, { fix, line }) => {
      const target: Rule = fix.scope === Scope.Line ? { id: line.id } : { payee: line.payee };
      const rule: Rule = {
        ...target,
        category: fix.category,
        ...(fix.for === undefined ? {} : { for: fix.for }),
        confirmed: true
      };
      return [rule, ...rules.filter((other) => !sameTarget(other, target))];
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

export interface Review {
  categories: string[];
  examples: { payee?: string; match?: string; category?: string; for?: string }[];
  groups: {
    payee: string;
    lines: number;
    total: number;
    currencies: string[];
    accounts: string[];
    entities: string[];
    samples: string[];
  }[];
}

/** The payees no rule categorises, biggest first, with the operator's approved rules as examples to learn from. */
export const reviewUncategorised = (dir: string, today: string, limit = 80): Review => {
  const input = loadFinance(dir, today);
  const own = classifyAll(input.txns, input.rules, input.entities).filter(
    (line) => (line.kind === 'spend' || line.kind === 'income') && line.category === null
  );
  const groups = [...Map.groupBy(own, (line) => line.payee.toLowerCase()).values()]
    .map((rows) => ({
      payee: rows[0]?.payee ?? '',
      lines: rows.length,
      total: Math.round(rows.reduce((sum, line) => sum + Math.abs(line.amount), 0)),
      currencies: [...new Set(rows.map((line) => line.currency))],
      accounts: [...new Set(rows.map((line) => line.account))],
      entities: [...new Set(rows.map((line) => line.for))],
      samples: [...new Set(rows.map((line) => line.raw))].slice(0, 3)
    }))
    .toSorted((a, b) => b.lines - a.lines || b.total - a.total)
    .slice(0, limit);
  return {
    categories: input.categories ?? [],
    examples: input.rules
      .filter((rule) => rule.confirmed === true && rule.category !== undefined)
      .map(({ payee, match, category, for: owner }) => ({ payee, match, category, for: owner })),
    groups
  };
};

export interface Suggestions {
  payees?: { match: string; payee: string }[];
  categories?: { payee?: string; match?: string; category: string; for?: string }[];
}

const isText = (value: unknown): boolean => value === undefined || typeof value === 'string';

/** The agent's suggestions JSON, refused when an entry isn't a rename or a category rule. */
export const parseSuggestions = (text: string): Suggestions => {
  const parsed: unknown = JSON.parse(text);
  const payees: unknown[] = isRecord(parsed) && Array.isArray(parsed.payees) ? parsed.payees : [];
  const categories: unknown[] = isRecord(parsed) && Array.isArray(parsed.categories) ? parsed.categories : [];
  const goodPayee = (item: unknown): item is { match: string; payee: string } =>
    isRecord(item) && typeof item.match === 'string' && typeof item.payee === 'string';
  const goodCategory = (item: unknown): item is { payee?: string; match?: string; category: string; for?: string } =>
    isRecord(item) &&
    typeof item.category === 'string' &&
    isText(item.payee) &&
    isText(item.match) &&
    isText(item.for) &&
    (item.payee !== undefined || item.match !== undefined);
  const bad = [...payees.filter((item) => !goodPayee(item)), ...categories.filter((item) => !goodCategory(item))];
  if (!isRecord(parsed) || bad.length > 0) {
    throw new Error(`not a suggestion: ${JSON.stringify(bad[0] ?? parsed)}`);
  }
  return { payees: payees.filter(goodPayee), categories: categories.filter(goodCategory) };
};

/**
 * Adds the agent's suggestions as unconfirmed rules, after the ones already there. A suggestion for a
 * payee or pattern that already has a rule is skipped: an existing decision or suggestion is never
 * overwritten by a new guess.
 */
export const addSuggestions = (
  dir: string,
  suggestions: Suggestions
): { payees: number; categories: number; skipped: number } => {
  const text = readRules(dir);
  const { payees, categories } = learnedRules(text);
  const known = (rule: Rule, rules: Rule[]): boolean => rules.some((other) => sameTarget(other, rule));
  const newPayees = (suggestions.payees ?? [])
    .filter((rule) => !known(rule, payees))
    .map(({ match, payee }) => ({ match, payee }));
  const newCategories = (suggestions.categories ?? [])
    .filter((rule) => rule.category.trim() !== '' && !known(rule, categories))
    .map(
      ({ payee, match, category, for: owner }): Rule => ({
        match,
        payee,
        category,
        ...(owner === undefined ? {} : { for: owner })
      })
    );
  const skipped =
    (suggestions.payees?.length ?? 0) + (suggestions.categories?.length ?? 0) - newPayees.length - newCategories.length;
  if (newPayees.length + newCategories.length > 0 || !existsSync(DATA.rules(dir))) {
    writeFileSync(DATA.rules(dir), withLearned(text, [...payees, ...newPayees], [...categories, ...newCategories]));
  }
  return { payees: newPayees.length, categories: newCategories.length, skipped };
};

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  const dir = argValue(rest, '--dir') ?? join(FOLDERS.PROJECTS, 'finances');
  const today = argValue(rest, '--today') ?? todayDate();
  const input = async (): Promise<string> => {
    const file = positionals(rest)[0];
    return file === undefined ? Bun.stdin.text() : readFileSync(file, 'utf8');
  };
  try {
    if (command === 'init') {
      if (!existsSync(DATA.rules(dir))) {
        writeFileSync(DATA.rules(dir), readFileSync(TEMPLATE, 'utf8'));
      }
      console.log(DATA.rules(dir));
    } else if (command === 'apply') {
      console.log(JSON.stringify(applyEdits(dir, parseEdits(await input()), today), null, 2));
    } else if (command === 'review') {
      const limit = argValue(rest, '--limit');
      console.log(
        JSON.stringify(reviewUncategorised(dir, today, limit === undefined ? undefined : Number(limit)), null, 2)
      );
    } else if (command === 'suggest') {
      console.log(JSON.stringify(addSuggestions(dir, parseSuggestions(await input())), null, 2));
    } else {
      console.error('usage: bun rules.ts <apply [file] | review | suggest [file] | init> [--dir <finances dir>]');
      process.exit(1);
    }
  } catch (error) {
    refuse(error);
  }
}
