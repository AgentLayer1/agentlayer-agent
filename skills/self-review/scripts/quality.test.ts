import { describe, expect, test } from 'bun:test';
import { findClosedRefs, findDuplicates, findNarrative, listItems, sentences } from './quality';

describe('quality findings', () => {
  test('a sentence said in two files is a duplicate; the same sentence twice in one file, or a loose echo, is not', () => {
    const manual = sentences({
      file: 'AGENTS.md',
      text: '# Manual\n\nCompiled inbox items land in the archive folder after every compile run. Unrelated words here.\n'
    });
    const index = sentences({
      file: 'knowledge/index.md',
      text: '- Compiled inbox items land in the archive folder after each compile run.\n- The archive folder holds old reports nobody reads.\n'
    });
    const found = findDuplicates([...manual, ...index]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: 'AGENTS.md', line: 3, with: { file: 'knowledge/index.md', line: 1 } });
    expect(findDuplicates([...manual, ...manual])).toEqual([]);
  });

  test('text inside a code fence is not prose', () => {
    const fenced = '```\n- Compiled inbox items land in the archive folder after every compile run.\n```\n';
    expect(listItems({ file: 'AGENTS.md', text: fenced })).toEqual([]);
    expect(sentences({ file: 'AGENTS.md', text: fenced })).toEqual([]);
  });

  test('a line naming only closed tasks speaks of finished work; one naming an open task too is live', () => {
    const items = listItems({
      file: 'knowledge/index.md',
      text: '- Sidebar work (ac-001).\n- Sidebar work (ac-001, ac-002).\n- Unknown ids (zz-999).\n'
    });
    const known = new Set(['ac-001', 'ac-002']);
    const found = findClosedRefs(items, known, new Set(['ac-001']));
    expect(found.map((row) => row.line)).toEqual([1]);
  });

  test('a bullet telling incidents is narrative; a rule with its required evidence clause is not', () => {
    const items = listItems({
      file: 'knowledge/memory/index.md',
      text: [
        '- **Verify first.** Read the file before a claim (11-02), it recurred on ac-004 (11-09) and again on 11-14.',
        '- **Verify first.** Read the file before a claim. Evidence: 12 entries 2026-06-15 to 2026-11-24, ac-001, ac-002.'
      ].join('\n')
    });
    expect(findNarrative(items).map((row) => row.line)).toEqual([1]);
  });
});
