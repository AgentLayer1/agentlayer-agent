import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'rule-compliance.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const usage = { input_tokens: 10, cache_creation_input_tokens: 40_000, cache_read_input_tokens: 0 };
const shell = (id: string, command: string, at: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: at,
    message: { model: 'model-a', usage, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
    ...extra
  });

const run = (lines: Record<string, string[]>, since = '2026-01-01') => {
  const dir = mkdtempSync(join(tmpdir(), 'rule-compliance-'));
  dirs.push(dir);
  Object.entries(lines).forEach(([name, rows]) => writeFileSync(join(dir, `${name}.jsonl`), `${rows.join('\n')}\n`));
  const proc = spawnSync(process.execPath, [SCRIPT, '--transcripts', dir, '--since', since]);
  return JSON.parse(proc.stdout.toString());
};

describe('rule-compliance', () => {
  test('counts shell calls, bare leading cd, commits and commits with a message file, per week', () => {
    const { weeks } = run({
      one: [
        shell('a', 'cd /repo && git status', '2026-03-02T10:00:00Z'),
        shell('b', '( cd /repo && bun test )', '2026-03-03T10:00:00Z'),
        shell('c', 'git -C /repo commit -q -F "$M"', '2026-03-04T10:00:00Z'),
        shell('d', 'git -C /repo commit -m "x"', '2026-03-05T10:00:00Z'),
        shell('e', 'git log --grep commit | head', '2026-03-10T10:00:00Z')
      ]
    });
    expect(weeks).toEqual([
      {
        week: '2026-03-02',
        sessions: 1,
        shellCalls: 4,
        leadingCd: 1,
        cdPer1000: 250,
        commits: 2,
        commitsWithFile: 1,
        fileShare: 0.5,
        firstTurnMedian: 40_010
      },
      {
        week: '2026-03-09',
        sessions: 1,
        shellCalls: 1,
        leadingCd: 0,
        cdPer1000: 0,
        commits: 0,
        commitsWithFile: 0,
        fileShare: null,
        firstTurnMedian: null
      }
    ]);
  });

  test('a repeated tool call id, a subagent row and a row before the window are not counted', () => {
    const { weeks } = run(
      {
        one: [
          shell('old', 'cd /old', '2026-02-01T10:00:00Z'),
          shell('a', 'cd /repo', '2026-03-02T10:00:00Z'),
          shell('a', 'cd /repo', '2026-03-02T10:00:01Z'),
          shell('side', 'cd /repo', '2026-03-02T10:00:02Z', { isSidechain: true })
        ]
      },
      '2026-03-01'
    );
    expect(weeks.map((week: { shellCalls: number }) => week.shellCalls)).toEqual([1]);
    expect(weeks[0].firstTurnMedian).toBeNull();
  });

  test('a week with enough calls outside a threshold is a regression; a thin week is not', () => {
    const commits = (count: number, withFile: number, day: string) =>
      Array.from({ length: count }, (_unused, i) =>
        shell(`${day}-${i}`, i < withFile ? 'git commit -F msg' : 'git commit -m x', `${day}T10:00:00Z`)
      );
    const { regressions } = run({
      busy: commits(20, 10, '2026-03-02'),
      thin: commits(4, 0, '2026-03-09')
    });
    expect(regressions).toEqual([{ week: '2026-03-02', rule: 'commit -F', value: 0.5 }]);
  });
});
