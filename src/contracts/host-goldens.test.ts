import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { PLUGIN_VERSION } from '@/config';
import { CLI_PATH, HOME_MARKER_FILES, PLUGIN_SOURCE_ROOT, RUNTIME_DIR, pluginName } from '@/shared/naming';
import { listMarkdown } from '@/shared/text';

const SCRATCH = mkdtempSync(resolve(tmpdir(), 'host-goldens-'));
const USER_HOME = resolve(SCRATCH, 'user');
const FAKE_BIN = resolve(SCRATCH, 'bin');

mkdirSync(USER_HOME, { recursive: true });
mkdirSync(FAKE_BIN, { recursive: true });
[
  ['claude', '2.9.999 (Claude Code)'],
  ['codex', 'codex-cli 9.999.0']
].forEach(([name, version]) => {
  const path = resolve(FAKE_BIN, name);
  writeFileSync(path, `#!/bin/sh\necho "${version}"\n`);
  chmodSync(path, 0o755);
});

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const FILES: Record<string, string> = {
  'SOUL.md': '# Soul\n\nSharp and kind.\n',
  'IDENTITY.md': '# Identity\n\n- **Name:** Nova\n- **Emoji:** 🦊\n',
  'USER.md': '# About Ada\n',
  'AGENTS.md': '# AGENTS.md\n\n## Memory Routing\n',
  '.claude/CLAUDE.md': '@../AGENTS.md\n',
  'knowledge/index.md': '# Knowledge Index\n',
  'knowledge/memory/index.md': '# Memory\n\n## Active Threads\n\n- none\n',
  'projects/TASKS.md': '# Tasks\n'
};

type Kind = 'initialized' | 'pre-init' | 'stranded';

const makeHome = (kind: Kind): string => {
  const home = mkdtempSync(resolve(SCRATCH, 'home-'));
  if (kind === 'stranded') {
    writeFileSync(resolve(home, 'SOUL.md'), FILES['SOUL.md'] ?? '');
  }
  if (kind === 'initialized') {
    mkdirSync(resolve(home, RUNTIME_DIR), { recursive: true });
    writeFileSync(resolve(home, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
    mkdirSync(resolve(home, 'knowledge', 'raw', 'sessions'), { recursive: true });
    Object.entries(FILES).forEach(([rel, content]) => {
      mkdirSync(dirname(resolve(home, rel)), { recursive: true });
      writeFileSync(resolve(home, rel), content);
    });
  }
  return home;
};

const WEEKDAY = /\b(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/g;
const MONTH =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/g;

// A JSON reply escapes its line breaks, which would hide the words after them from the `\b` patterns below.
const normalize = (text: string, home: string): string =>
  text
    .replaceAll('\\n', '\n')
    .replaceAll(home, '<HOME>')
    .replaceAll(USER_HOME, '<USER>')
    .replaceAll(SCRATCH, '<SCRATCH>')
    .replaceAll(PLUGIN_SOURCE_ROOT, '<ROOT>')
    .replaceAll(`v${PLUGIN_VERSION}`, 'v<VERSION>')
    .replaceAll(PLUGIN_VERSION, '<VERSION>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, '<TIMESTAMP>')
    .replace(/\d{4}-\d{2}-\d{2}/g, '<DATE>')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<TIME>')
    .replace(WEEKDAY, '<WEEKDAY>')
    .replace(MONTH, '<MONTH>')
    .replace(/<MONTH> \d{1,2}, \d{4}/g, '<MONTH> <DAY>, <YEAR>')
    .replace(/[+-]\d{4}\b/g, '<OFFSET>');

interface Run {
  stdout: string;
  stderr: string;
  exit: number;
}

const cli = (
  home: string,
  args: string[],
  { stdin = '', env = {} }: { stdin?: string; env?: Record<string, string> } = {}
): Run => {
  const result = Bun.spawnSync(['bun', CLI_PATH, ...args], {
    cwd: home,
    stdin: new TextEncoder().encode(stdin),
    env: {
      PATH: [FAKE_BIN, dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
      HOME: USER_HOME,
      TZ: 'UTC',
      AGENT_TIMEZONE: 'UTC',
      AGENT_HOME: home,
      ...env
    }
  });
  return {
    stdout: normalize(result.stdout.toString(), home),
    stderr: normalize(result.stderr.toString(), home),
    exit: result.exitCode
  };
};

const dayFiles = (home: string): string => {
  const sessions = resolve(home, 'knowledge', 'raw', 'sessions');
  return listMarkdown(sessions)
    .map((name) => normalize(`--- ${name}\n${readFileSync(resolve(sessions, name), 'utf-8')}`, home))
    .join('\n');
};

const claudeTranscript = (home: string, turns: number): string => {
  const path = resolve(home, 'claude-transcript.jsonl');
  const lines = Array.from({ length: turns }, (_unused, index) =>
    JSON.stringify({
      type: index % 2 === 0 ? 'user' : 'assistant',
      message: { role: index % 2 === 0 ? 'user' : 'assistant', content: `claude turn ${index + 1}` }
    })
  );
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
};

const codexRollout = (home: string, turns: number): string => {
  const path = resolve(home, 'rollout-2026-09-07T01-43-38-01a077d1-91e1-7cc1-a3a8-ced457819b33.jsonl');
  const message = (role: string, text: string) =>
    JSON.stringify({
      timestamp: '2026-09-06T17:44:08.852Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role,
        content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }]
      }
    });
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { id: '01a077d1-91e1-7cc1-a3a8-ced457819b33', cwd: home } }),
    JSON.stringify({ type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-test' } }),
    ...Array.from({ length: turns }, (_unused, index) =>
      message(index % 2 === 0 ? 'user' : 'assistant', `codex turn ${index + 1}`)
    )
  ];
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
};

const SESSION_ID = '0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6';

describe('session start, per host and home state', () => {
  const kinds: Kind[] = ['initialized', 'pre-init', 'stranded'];

  test.each(kinds)('Claude Code, %s home', (kind) => {
    const home = makeHome(kind);
    expect(
      cli(home, ['session-start', '--hook-protocol=claude'], { env: { CLAUDE_PROJECT_DIR: home } })
    ).toMatchSnapshot();
  });

  test('Claude Code in its terminal, initialized home', () => {
    const home = makeHome('initialized');
    const env = { CLAUDE_PROJECT_DIR: home, CLAUDE_CODE_ENTRYPOINT: 'cli' };
    expect(cli(home, ['session-start', '--hook-protocol=claude'], { env })).toMatchSnapshot();
  });

  test.each(kinds)('Codex, %s home', (kind) => {
    const home = makeHome(kind);
    expect(cli(home, ['session-start', '--hook-protocol=codex', `--home=${home}`])).toMatchSnapshot();
  });

  test('no protocol, initialized home', () => {
    const home = makeHome('initialized');
    expect(cli(home, ['session-start'])).toMatchSnapshot();
  });

  test('an unknown protocol is refused', () => {
    const home = makeHome('initialized');
    const run = cli(home, ['session-start', '--hook-protocol=acme']);
    expect(run.exit).not.toBe(0);
    expect(run.stdout).toMatchSnapshot();
  });
});

describe('the shell guard, per host', () => {
  const payload = (command: string, cwd: string) => JSON.stringify({ tool_input: { command }, cwd });
  const cases = [
    ['an ordinary command', (home: string) => payload('ls -la', home)],
    [
      'a home-tree write from outside the home',
      (home: string) => payload('echo x > projects/x.md', resolve(home, '..'))
    ],
    ['a cd that carries over', (home: string) => payload(`cd ${resolve(home, '..')}`, home)],
    ['a history rewrite', (home: string) => payload('git commit --amend', home)]
  ] as const;

  test.each(cases)('Claude Code: %s', (_label, input) => {
    const home = makeHome('initialized');
    expect(
      cli(home, ['guard', '--hook-protocol=claude'], { stdin: input(home), env: { CLAUDE_PROJECT_DIR: home } })
    ).toMatchSnapshot();
  });

  test.each(cases)('Codex: %s', (_label, input) => {
    const home = makeHome('initialized');
    expect(cli(home, ['guard', '--hook-protocol=codex', `--home=${home}`], { stdin: input(home) })).toMatchSnapshot();
  });

  test('outside a home there is nothing to guard', () => {
    const home = makeHome('pre-init');
    expect(
      cli(home, ['guard', '--hook-protocol=claude'], { stdin: payload('echo x > projects/x.md', '/') })
    ).toMatchSnapshot();
  });
});

describe('session capture, per host', () => {
  const hookPayload = (transcript: string, cwd: string) =>
    JSON.stringify({ session_id: SESSION_ID, transcript_path: transcript, cwd });

  test.each(['session-end', 'pre-compact'] as const)('Claude Code, %s', (mode) => {
    const home = makeHome('initialized');
    const run = cli(home, ['session-capture', `--mode=${mode}`, '--hook-protocol=claude'], {
      stdin: hookPayload(claudeTranscript(home, 6), home),
      env: { CLAUDE_PROJECT_DIR: home }
    });
    expect({ ...run, days: dayFiles(home) }).toMatchSnapshot();
  });

  test.each(['session-end', 'pre-compact'] as const)('Codex, %s', (mode) => {
    const home = makeHome('initialized');
    const run = cli(home, ['session-capture', `--mode=${mode}`, '--hook-protocol=codex', `--home=${home}`], {
      stdin: hookPayload(codexRollout(home, 6), home)
    });
    expect({ ...run, days: dayFiles(home) }).toMatchSnapshot();
  });

  test('by hand, with --format overriding the default extractor', () => {
    const home = makeHome('initialized');
    const run = cli(home, [
      'session-capture',
      '--mode=session-end',
      `--transcript=${codexRollout(home, 4)}`,
      `--cwd=${home}`,
      `--session-id=${SESSION_ID}`,
      '--format=codex'
    ]);
    expect({ ...run, days: dayFiles(home) }).toMatchSnapshot();
  });

  test('an unknown --format is refused', () => {
    const home = makeHome('initialized');
    const run = cli(home, ['session-capture', '--mode=session-end', '--format=acme']);
    expect(run.exit).not.toBe(0);
  });

  test("a queued Codex capture keeps its format through the queue and is drained at Codex's session start", () => {
    const home = makeHome('initialized');
    const queued = {
      transcriptPath: codexRollout(home, 4),
      cwd: home,
      sessionId: SESSION_ID,
      mode: 'session-end',
      format: 'codex'
    };
    writeFileSync(resolve(home, RUNTIME_DIR, 'capture-pending.jsonl'), `${JSON.stringify(queued)}\n`);
    const run = cli(home, ['session-start', '--hook-protocol=codex', `--home=${home}`]);
    expect(run.exit).toBe(0);
    expect(dayFiles(home)).toMatchSnapshot();
  });
});
