import { describe, expect, test } from 'bun:test';
import { operatorTurns, renderOperatorTurns } from '@/knowledge/operator-turns';
import { ENTRY_SEPARATOR } from '@/knowledge/session-format';

const block = (id: string, date: string, turns: string[]): string =>
  [`### Session (10:00) [${id}] · ${date} · ~/Home · turns 1–${turns.length}`, ...turns].join('\n\n');

const FIRST = '11111111-aaaa-bbbb-cccc-000000000001';
const SECOND = '22222222-aaaa-bbbb-cccc-000000000002';

describe('operatorTurns', () => {
  test('keeps what the operator typed, with its session and date, and drops injected turns', () => {
    const chunk = [
      block(FIRST, '2026-03-02', [
        '**User:** no, search by name, not by email',
        '**Assistant:** Searching by name.',
        '**User:** <task-notification>\n<status>completed</status>\n</task-notification>',
        '**User:** Base directory for this skill: /plugin/skills/sync\n\n# Sync',
        '**User:** <command-message>acme:sync</command-message>',
        '**User:** [Request interrupted by user]'
      ]),
      block(SECOND, '2026-03-03', ['**User:** that is not what they asked\n\nthey asked why', '**Assistant:** Right.'])
    ].join(ENTRY_SEPARATOR);

    expect(operatorTurns(chunk)).toEqual([
      { sessionId: FIRST, date: '2026-03-02', text: 'no, search by name, not by email' },
      { sessionId: SECOND, date: '2026-03-03', text: 'that is not what they asked\n\nthey asked why' }
    ]);
  });

  test('a block whose header carries no turn range has no session to key on, so its turns are left out', () => {
    expect(operatorTurns('### Session (10:00) [abc] · 2026-03-02\n\n**User:** no, the other one')).toEqual([]);
  });

  test('renders one line per turn, flattened and cut, and says so when there are none', () => {
    const [line] = renderOperatorTurns([
      { sessionId: FIRST, date: '2026-03-02', text: `no\n${'x'.repeat(300)}` }
    ]).split('\n');
    expect(line.startsWith(`- session \`${FIRST}\` · date \`2026-03-02\` · no xxx`)).toBe(true);
    expect(line.endsWith('…')).toBe(true);
    expect(renderOperatorTurns([])).toBe('_None in this chunk._');
  });
});
