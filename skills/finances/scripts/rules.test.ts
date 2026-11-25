import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildFinance, learnedRules, loadFinance, ruleKey } from './build';
import { importStatement } from './import';
import {
  addSuggestions,
  applyEdits,
  parseEdits,
  parseSuggestions,
  reviewUncategorised,
  ruleLine,
  Scope,
  withLearned
} from './rules';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const TODAY = '2026-11-02';
const PROSE = '# Finances rules\n\n## How I categorise\n\n- Streamco is a subscription, never entertainment.\n';
const SUGGESTION = { payee: 'STREAMCO KL', category: 'entertainment' };

const project = (
  rules:
    | string
    | null = `${PROSE}\n## Learned\n\n### Payees\n\n\`\`\`yaml\n[]\n\`\`\`\n\n### Categories\n\n\`\`\`yaml\n${ruleLine(SUGGESTION)}\n\`\`\`\n\n## Notes\n\nKept as written.\n`
): string => {
  const dir = mkdtempSync(join(tmpdir(), 'finances-rules-'));
  dirs.push(dir);
  const write = (file: string, body: string): string => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), body);
    return join(dir, file);
  };
  write(
    'entities/ada.md',
    '---\nname: Personal\nkind: individual\nclose: none\n---\n\n## Accounts\n\n```yaml\n- { id: ada-main, name: Ada current }\n```\n'
  );
  if (rules !== null) {
    write('RULES.md', rules);
  }
  importStatement({
    dir,
    account: 'ada-main',
    file: write(
      'data/inbox/s.csv',
      'date,description,amount,balance\n2026-09-05,STREAMCO*884412 KL,-45,955\n2026-10-05,STREAMCO*884413 KL,-45,910\n2026-10-14,RESTO X,-80,830\n2026-10-20,RESTO X,-60,770\n'
    )
  });
  return dir;
};

const lines = (dir: string) => buildFinance(loadFinance(dir, TODAY)).lines;
const idOf = (dir: string, date: string): string => lines(dir).find((line) => line.date === date)?.id ?? '';
const block = (edits: object): string =>
  `Here you go:\n\n\`\`\`finances-edits\n${JSON.stringify({ v: 1, ...edits })}\n\`\`\`\n`;

describe('parseEdits', () => {
  test('reads the fenced block, or the JSON alone', () => {
    const edits = { approve: ['k1'], set: [{ line: 'x', category: 'food', scope: Scope.Payee }] };
    expect(parseEdits(block(edits))).toEqual(edits);
    expect(parseEdits(JSON.stringify({ v: 1, ...edits }))).toEqual(edits);
  });

  test('refuses another version or a malformed fix', () => {
    expect(() => parseEdits('{"v":2}')).toThrow('version 1');
    expect(() => parseEdits('{"v":1,"set":[{"line":"x","category":"","scope":"payee"}]}')).toThrow('malformed');
  });
});

describe('applyEdits', () => {
  test('approving a suggestion confirms it, and every line it covers is approved', () => {
    const dir = project();
    const report = applyEdits(dir, parseEdits(block({ approve: [ruleKey(SUGGESTION)], set: [] })), TODAY);
    expect(report).toMatchObject({ approved: 1, unknown: [], changed: true });
    expect(
      lines(dir)
        .filter((line) => line.payee === 'STREAMCO KL')
        .every((line) => line.approved)
    ).toBe(true);
  });

  test('a fix by payee replaces the suggestion and teaches every line from that payee', () => {
    const dir = project();
    applyEdits(
      dir,
      parseEdits(
        block({ approve: [], set: [{ line: idOf(dir, '2026-10-05'), category: 'subscriptions', scope: Scope.Payee }] })
      ),
      TODAY
    );
    const { categories } = learnedRules(readFileSync(join(dir, 'RULES.md'), 'utf8'));
    expect(categories).toEqual([{ payee: 'STREAMCO KL', category: 'subscriptions', confirmed: true }]);
    expect(
      lines(dir)
        .filter((line) => line.payee === 'STREAMCO KL')
        .map((line) => [line.category, line.approved])
    ).toEqual([
      ['subscriptions', true],
      ['subscriptions', true]
    ]);
  });

  test('a fix for one line changes that line alone', () => {
    const dir = project();
    const id = idOf(dir, '2026-10-14');
    applyEdits(
      dir,
      parseEdits(block({ approve: [], set: [{ line: id, category: 'food', for: 'ada', scope: Scope.Line }] })),
      TODAY
    );
    const resto = lines(dir).filter((line) => line.payee === 'RESTO X');
    expect(resto.map((line) => [line.date, line.category])).toEqual([
      ['2026-10-14', 'food'],
      ['2026-10-20', null]
    ]);
  });

  test('the same paste twice changes nothing the second time, and the prose and later sections are untouched', () => {
    const dir = project();
    const edits = parseEdits(
      block({
        approve: [ruleKey(SUGGESTION)],
        set: [{ line: idOf(dir, '2026-10-20'), category: 'food', scope: Scope.Payee }]
      })
    );
    applyEdits(dir, edits, TODAY);
    const once = readFileSync(join(dir, 'RULES.md'), 'utf8');
    expect(applyEdits(dir, edits, TODAY).changed).toBe(false);
    expect(readFileSync(join(dir, 'RULES.md'), 'utf8')).toBe(once);
    expect(once.startsWith(PROSE)).toBe(true);
    expect(once.endsWith('## Notes\n\nKept as written.\n')).toBe(true);
  });

  test('an unknown rule, line or entity is reported, never guessed at', () => {
    const dir = project();
    const report = applyEdits(
      dir,
      parseEdits(
        block({
          approve: ['nope'],
          set: [
            { line: 'missing', category: 'food', scope: Scope.Payee },
            { line: idOf(dir, '2026-10-14'), category: 'food', for: 'acme', scope: Scope.Payee }
          ]
        })
      ),
      TODAY
    );
    expect(report).toEqual({
      approved: 0,
      set: 0,
      unknown: ['rule nope', 'line missing', 'for: acme'],
      changed: false
    });
  });

  test('a project without RULES.md gets one from the template, with the decision in its learned section', () => {
    const dir = project(null);
    applyEdits(
      dir,
      parseEdits(
        block({ approve: [], set: [{ line: idOf(dir, '2026-10-14'), category: 'food', scope: Scope.Payee }] })
      ),
      TODAY
    );
    const text = readFileSync(join(dir, 'RULES.md'), 'utf8');
    expect(text).toContain('## How I categorise');
    expect(learnedRules(text).categories).toEqual([{ payee: 'RESTO X', category: 'food', confirmed: true }]);
    expect(existsSync(join(dir, 'RULES.md'))).toBe(true);
  });
});

describe('withLearned', () => {
  test('adds the section to a file that has none, and writes rules in a stable field order', () => {
    const text = withLearned('# Rules\n', [], [{ confirmed: true, category: 'food', payee: 'A "B"' }]);
    expect(text).toBe(
      '# Rules\n\n## Learned\n\n### Payees\n\n```yaml\n[]\n```\n\n### Categories\n\n```yaml\n- { payee: "A \\"B\\"", category: "food", confirmed: true }\n```\n'
    );
    expect(learnedRules(text).categories).toEqual([{ payee: 'A "B"', category: 'food', confirmed: true }]);
  });
});

describe('reviewUncategorised', () => {
  test('lists the payees no rule covers, with samples, and the approved rules as examples', () => {
    const dir = project();
    applyEdits(dir, parseEdits(block({ approve: [ruleKey(SUGGESTION)], set: [] })), TODAY);
    const review = reviewUncategorised(dir, TODAY);
    expect(review.groups).toEqual([
      {
        payee: 'RESTO X',
        lines: 2,
        total: 140,
        currencies: ['MYR'],
        accounts: ['ada-main'],
        entities: ['ada'],
        samples: ['RESTO X']
      }
    ]);
    expect(review.examples).toEqual([{ payee: 'STREAMCO KL', category: 'entertainment' }]);
    expect(review.categories).toContain('groceries');
  });
});

describe('addSuggestions', () => {
  test('adds new suggestions unconfirmed, and never overwrites a payee that already has a rule', () => {
    const dir = project();
    const report = addSuggestions(
      dir,
      parseSuggestions(
        JSON.stringify({
          payees: [{ match: '^RESTO', payee: 'Resto' }],
          categories: [
            { payee: 'Resto', category: 'food' },
            { payee: 'STREAMCO KL', category: 'subscriptions' }
          ]
        })
      )
    );
    expect(report).toEqual({ payees: 1, categories: 1, skipped: 1 });
    const rules = learnedRules(readFileSync(join(dir, 'RULES.md'), 'utf8'));
    expect(rules.payees).toEqual([{ match: '^RESTO', payee: 'Resto' }]);
    expect(rules.categories).toEqual([SUGGESTION, { payee: 'Resto', category: 'food' }]);
    expect(
      lines(dir)
        .filter((line) => line.payee === 'Resto')
        .map((line) => [line.category, line.approved])
    ).toEqual([
      ['food', false],
      ['food', false]
    ]);
  });

  test('refuses an entry that is neither a rename nor a category rule', () => {
    expect(() => parseSuggestions('{"categories":[{"category":"food"}]}')).toThrow('not a suggestion');
  });

  test('refuses a batch the build could not read, and leaves RULES.md as it was', () => {
    const dir = project();
    const before = readFileSync(join(dir, 'RULES.md'), 'utf8');
    expect(() => addSuggestions(dir, { payees: [{ match: '*GRAB', payee: 'Grab' }] })).toThrow('not a valid pattern');
    expect(() => addSuggestions(dir, { categories: [{ payee: 'Resto', category: 'food', for: 'nobody' }] })).toThrow(
      'is not an entity'
    );
    expect(readFileSync(join(dir, 'RULES.md'), 'utf8')).toBe(before);
    expect(lines(dir).length).toBeGreaterThan(0);
  });
});
