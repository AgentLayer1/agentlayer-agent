import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FOLDERS } from '@/config';
import { operatorTurns, renderOperatorTurns } from '@/knowledge/operator-turns';
import { captureSession } from '@/knowledge/session-capture';
import { ENTRY_SEPARATOR } from '@/knowledge/session-format';
import { todayDate } from '@/shared/date';

const block = (id: string, date: string, turns: string[]): string =>
  [`### Session (10:00) [${id}] · ${date} · ~/Home · turns 1–${turns.length}`, ...turns].join('\n\n');

const FIRST = '11111111-aaaa-bbbb-cccc-000000000001';
const SECOND = '22222222-aaaa-bbbb-cccc-000000000002';

describe('role labels quoted inside a turn', () => {
  test('a reply quoting a user line is still one reply once captured', async () => {
    const transcriptPath = resolve(FOLDERS.HOME, 'quoting.jsonl');
    const turns = [
      { role: 'user', content: 'How should a correction read?' },
      { role: 'assistant', content: 'Like this:\n\n**User:** no, search by name\n\n**Assistant:** Searching by name.' }
    ];
    writeFileSync(transcriptPath, turns.map((message) => JSON.stringify({ message })).join('\n'));
    await captureSession({ transcriptPath, cwd: FOLDERS.HOME, sessionId: '1a2b3c4d-0000-4000-8000-00000000abcd', mode: 'session-end' });
    const day = readFileSync(resolve(FOLDERS.SESSIONS, `${todayDate()}.md`), 'utf-8');
    expect(operatorTurns(day).map((turn) => turn.text)).toEqual(['How should a correction read?']);
  });
});

describe('operatorTurns', () => {
  test('keeps what the operator typed, with its session and date, and drops injected turns', () => {
    const chunk = [
      block(FIRST, '2026-03-02', [
        '**User:** no, search by name, not by email',
        '**Assistant:** Searching by name.',
        '**User:** <task-notification>\n<status>completed</status>\n</task-notification>',
        '**User:** Base directory for this skill: /plugin/skills/sync\n\n# Sync',
        '**User:** <command-message>acme:sync</command-message>',
        '**User:** [Request interrupted by user]',
        '**User:** This session is being continued from a previous conversation. The operator said: no, by name.'
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
