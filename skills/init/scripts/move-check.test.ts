import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'move-check.ts');
const OLD = '/Users/ada/Agents/Scout';
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const run = (home: string, ...extra: string[]) => {
  const proc = spawnSync(process.execPath, [SCRIPT, '--home', home, ...extra], { encoding: 'utf-8' });
  if (proc.status !== 0) throw new Error(proc.stderr);
  return JSON.parse(proc.stdout);
};

/** A home moved from `Scout` on the `agent-scout` plugin, with the log the move left. */
const movedHome = (log: Record<string, unknown> | null = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'move-check-'));
  dirs.push(home);
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(home, rel)), { recursive: true });
    writeFileSync(join(home, rel), text);
  };
  write(
    '.state/version.json',
    JSON.stringify({ plugin: 'agentlayer', migratedFrom: { home: OLD, name: 'Scout', ...(log ? { log: '.state/logs/move.json' } : {}) } })
  );
  write('projects/acme/tasks/ac-001.md', '# Access\n\n- A dedicated WordPress user, `agentlayer`, on the lowest role.\n');
  write('projects/acme/contracts/sow.md', 'The team adopted **agentlayer** for its launch.\n');
  write('knowledge/concepts/plugin.md', 'Intro.\n\nOppi runs the sync.\n');
  write('.claude/settings.local.json', JSON.stringify({ env: { AGENT_CODE_PATH: `${OLD}/code` } }));
  if (log) {
    write(
      '.state/logs/move.json',
      JSON.stringify({
        persona: [{ path: 'knowledge/concepts/plugin.md', line: 3, before: 'Scout runs the sync.', after: 'Oppi runs the sync.' }],
        product: [
          { path: 'projects/acme/tasks/ac-001.md', line: 3, before: '- A dedicated WordPress user, `agent-scout`, on the lowest role.', after: '- A dedicated WordPress user, `agentlayer`, on the lowest role.' },
          { path: 'projects/acme/contracts/sow.md', line: 1, before: 'The team adopted **agent-scout** for its launch.', after: 'The team adopted **agentlayer** for its launch.' }
        ],
        leftovers: ['.claude/settings.local.json env.HELPDESK_USERNAME: agent-scout'],
        captured: [{ id: 'abcd1234-open', turns: 4 }],
        ...log
      })
    );
  }
  return home;
};

describe('move-check', () => {
  test('flags a renamed login and a renamed contract, lists the other renames, and finds the stale settings path', () => {
    const home = movedHome();
    const result = run(home);
    expect(result.renamed).toBe(3);
    expect(result.flagged.map((rename: { path: string; why: string }) => [rename.path, rename.why])).toEqual([
      ['projects/acme/tasks/ac-001.md', 'names a login the settings still use'],
      ['projects/acme/contracts/sow.md', 'a document as sent or signed']
    ]);
    expect(result.renames).toEqual(['knowledge/concepts/plugin.md:3 | Scout runs the sync.']);
    expect(result.stale).toEqual([{ file: '.claude/settings.local.json', names: [OLD] }]);
    expect(result.history).toEqual({ ok: true, detail: 'no history' });
    expect(result.captured).toEqual([{ id: 'abcd1234-open', turns: 4 }]);
  });

  test('a restore puts the original text back, finds a line that moved, refuses one changed since, and runs twice safely', () => {
    const home = movedHome();
    const task = join(home, 'projects/acme/tasks/ac-001.md');
    writeFileSync(task, `# Access\n\nAdded since the move.\n\n${readFileSync(task, 'utf-8').split('\n')[2]}\n`);
    writeFileSync(join(home, 'projects/acme/contracts/sow.md'), 'The team adopted it, as edited by hand.\n');
    const first = run(home, '--restore', 'projects/acme/tasks/ac-001.md:3', '--restore', 'projects/acme/contracts/sow.md:1');
    expect(first.restore).toEqual([
      { line: 'projects/acme/tasks/ac-001.md:3', restored: true },
      { line: 'projects/acme/contracts/sow.md:1', restored: false, reason: 'changed since the move; left alone' }
    ]);
    expect(readFileSync(task, 'utf-8')).toContain('- A dedicated WordPress user, `agent-scout`, on the lowest role.');
    const again = run(home, '--restore', 'projects/acme/tasks/ac-001.md:3');
    expect(again.restore[0]).toEqual({ line: 'projects/acme/tasks/ac-001.md:3', restored: false, reason: 'already restored' });
    expect(readFileSync(task, 'utf-8').match(/agent-scout/g)).toHaveLength(1);
  });

  test('a home moved without a change list has nothing to check', () => {
    expect(run(movedHome(null)).log).toBeNull();
  });
});
