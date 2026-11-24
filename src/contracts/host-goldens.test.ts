import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { PLUGIN_VERSION } from '@/config';
import { CLI_PATH, HOME_MARKER_FILES, PLUGIN_SOURCE_ROOT, RUNTIME_DIR, pluginName } from '@/shared/naming';
import { listMarkdown } from '@/shared/text';

// The fixtures are POSIX shell scripts, and the history line needs a system git it accepts (on macOS, with Command
// Line Tools installed); elsewhere the goldens would pin the machine instead of the plugin.
const POSIX_GIT =
  process.platform !== 'win32' &&
  Bun.which('git', { PATH: '/usr/bin:/bin' }) !== null &&
  (process.platform !== 'darwin' || Bun.spawnSync(['xcode-select', '-p']).exitCode === 0);

const SCRATCH = mkdtempSync(resolve(tmpdir(), 'host-goldens-'));
const USER_HOME = resolve(SCRATCH, 'user');
const FAKE_BIN = resolve(SCRATCH, 'bin');

mkdirSync(USER_HOME, { recursive: true });
mkdirSync(FAKE_BIN, { recursive: true });
[
  ['claude', '2.9.999 (Claude Code)'],
  ['codex', 'codex-cli 9.999.0'],
  ['agy', '9.999.0']
].forEach(([name, version]) => {
  const path = resolve(FAKE_BIN, name);
  writeFileSync(path, `#!/bin/sh\necho "${version}"\n`);
  chmodSync(path, 0o755);
});

const LANE_FAILS = resolve(SCRATCH, 'lane-fails.ts');
writeFileSync(
  LANE_FAILS,
  "Bun.plugin({ name: 'lane-fails', setup(build) { build.onLoad({ filter: /src\\/hooks\\/context\\.ts$/ }, () => ({ contents: 'export const assembleContext = async () => { throw new Error(\"lane down\"); };', loader: 'ts' })); } });\n"
);

const START_FAILS = resolve(SCRATCH, 'start-fails.ts');
writeFileSync(
  START_FAILS,
  "Bun.plugin({ name: 'start-fails', setup(build) { build.onLoad({ filter: /src\\/hooks\\/context\\.ts$/ }, () => ({ contents: 'export const assembleContext = async () => ({ context: \"\", hasIssues: false });', loader: 'ts' })); } });\n"
);

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
  { stdin = '', env = {}, preload = [] }: { stdin?: string; env?: Record<string, string>; preload?: string[] } = {}
): Run => {
  const result = Bun.spawnSync(['bun', ...preload.flatMap((file) => ['--preload', file]), CLI_PATH, ...args], {
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

const antigravityTranscript = (home: string, turns: number): string => {
  const path = resolve(home, 'antigravity-transcript.jsonl');
  const steps = Array.from({ length: turns }, (_unused, index) =>
    index % 2 === 0
      ? {
          step_index: index,
          source: 'USER_EXPLICIT',
          type: 'USER_INPUT',
          content: `<USER_REQUEST>\nantigravity turn ${index + 1}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-09-06T17:44:08Z.\n</ADDITIONAL_METADATA>`
        }
      : {
          step_index: index,
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          model: 'gemini-test',
          content: `antigravity turn ${index + 1}`
        }
  );
  const noise = [
    { step_index: 90, source: 'SYSTEM_SDK', type: 'SYSTEM_MESSAGE', content: 'injected context' },
    { step_index: 91, source: 'MODEL', type: 'PLANNER_RESPONSE', model: 'gemini-test', content: '' },
    { step_index: 92, source: 'MODEL', type: 'GENERIC', content: 'a tool result' }
  ];
  writeFileSync(path, `${[...noise, ...steps].map((step) => JSON.stringify(step)).join('\n')}\n`);
  return path;
};

const antigravityPayload = (home: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    conversationId: SESSION_ID,
    cwd: home,
    workspacePaths: [home],
    hookEventName: 'SessionStart',
    lastUserInput: 'hi',
    transcriptPath: resolve(home, 'antigravity-transcript.jsonl'),
    ...extra
  });

const SESSION_ID = '0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6';

describe.skipIf(!POSIX_GIT)('session start, per host and home state', () => {
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

  test.each(kinds)('Antigravity, %s home', (kind) => {
    const home = makeHome(kind);
    antigravityTranscript(home, 1);
    expect(
      cli(home, ['session-start', '--hook-protocol=antigravity', `--home=${home}`], { stdin: antigravityPayload(home) })
    ).toMatchSnapshot();
  });

  test("an Antigravity subagent's start gets no context", () => {
    const home = makeHome('initialized');
    const stdin = antigravityPayload(home, { lastUserInput: '', transcriptPath: resolve(home, 'not-yet.jsonl') });
    expect(cli(home, ['session-start', '--hook-protocol=antigravity', `--home=${home}`], { stdin })).toMatchSnapshot();
  });

  test("an Antigravity session start records its conversation for the drain, and a subagent's does not", () => {
    const home = makeHome('initialized');
    antigravityTranscript(home, 1);
    const open = resolve(home, RUNTIME_DIR, 'conversations', 'open.json');
    const child = antigravityPayload(home, {
      conversationId: 'child-0000',
      lastUserInput: '',
      transcriptPath: resolve(home, 'not-yet.jsonl')
    });
    cli(home, ['session-start', '--hook-protocol=antigravity', `--home=${home}`], { stdin: child });
    cli(home, ['session-start', '--hook-protocol=antigravity', `--home=${home}`], { stdin: antigravityPayload(home) });
    expect(Object.keys(JSON.parse(readFileSync(open, 'utf-8')) as object)).toEqual([SESSION_ID]);
  });

  test('no protocol, initialized home', () => {
    const home = makeHome('initialized');
    expect(cli(home, ['session-start'])).toMatchSnapshot();
  });

  test('a failed dynamic lane costs only the lane, on either host', () => {
    const home = makeHome('initialized');
    const preload = [LANE_FAILS];
    const claude = cli(home, ['session-start', '--hook-protocol=claude'], {
      env: { CLAUDE_PROJECT_DIR: home },
      preload
    });
    const codex = cli(home, ['session-start', '--hook-protocol=codex', `--home=${home}`], { preload });
    expect([claude.exit, codex.exit]).toEqual([0, 0]);
    expect(claude.stdout).toContain('dynamic session context unavailable: lane down');
    expect(codex.stdout).toContain('dynamic session context unavailable: lane down');
    expect(codex.stdout).toContain('<!-- file: SOUL.md -->');
  });

  test('a session start that fails answers an empty reply and exits 1, on either host', () => {
    const home = makeHome('initialized');
    const preload = [START_FAILS];
    const claude = cli(home, ['session-start', '--hook-protocol=claude'], {
      env: { CLAUDE_PROJECT_DIR: home },
      preload
    });
    const codex = cli(home, ['session-start', '--hook-protocol=codex', `--home=${home}`], { preload });
    expect({
      claude: { stdout: claude.stdout, exit: claude.exit },
      codex: { stdout: codex.stdout, exit: codex.exit }
    }).toMatchSnapshot();
  });

  test('an unknown protocol is refused', () => {
    const home = makeHome('initialized');
    const run = cli(home, ['session-start', '--hook-protocol=acme']);
    expect(run.exit).not.toBe(0);
    expect(run.stdout).toMatchSnapshot();
  });
});

describe.skipIf(!POSIX_GIT)('the shell guard, per host', () => {
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

  test.each(cases)('Antigravity: %s', (_label, input) => {
    const home = makeHome('initialized');
    const { tool_input: toolInput, cwd } = JSON.parse(input(home)) as { tool_input: { command: string }; cwd: string };
    const stdin = antigravityPayload(home, {
      hookEventName: 'PreToolUse',
      cwd,
      toolCall: { id: '1', name: 'run_command', args: { CommandLine: toolInput.command, WaitMsBeforeAsync: 5000 } }
    });
    expect(cli(home, ['guard', '--hook-protocol=antigravity', `--home=${home}`], { stdin })).toMatchSnapshot();
  });

  test('a payload with unescaped backslashes is repaired and still guarded', () => {
    const home = makeHome('initialized');
    const stdin = `{"tool_input":{"command":"git commit --amend"},"cwd":"${home}","note":"C:\\Users\\acme"}`;
    expect(
      cli(home, ['guard', '--hook-protocol=claude'], { stdin, env: { CLAUDE_PROJECT_DIR: home } })
    ).toMatchSnapshot();
  });

  test('a call with no command, no cwd or no payload is let through', () => {
    const home = makeHome('initialized');
    const runs = [
      JSON.stringify({ tool_input: { file_path: resolve(home, 'SOUL.md') }, cwd: home }),
      JSON.stringify({ tool_input: { command: 'git commit --amend' } }),
      ''
    ].map((stdin) => cli(home, ['guard', '--hook-protocol=claude'], { stdin, env: { CLAUDE_PROJECT_DIR: home } }));
    expect(runs).toMatchSnapshot();
  });

  test("an unknown protocol falls back to Claude Code's guard", () => {
    const home = makeHome('initialized');
    expect(
      cli(home, ['guard', '--hook-protocol=acme'], { stdin: payload('git commit --amend', home) })
    ).toMatchSnapshot();
  });

  test('outside a home there is nothing to guard', () => {
    const home = makeHome('pre-init');
    expect(
      cli(home, ['guard', '--hook-protocol=claude'], { stdin: payload('echo x > projects/x.md', '/') })
    ).toMatchSnapshot();
  });
});

describe.skipIf(!POSIX_GIT)('session capture, per host', () => {
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

  test('Antigravity, session-end', () => {
    const home = makeHome('initialized');
    const stdin = antigravityPayload(home, { hookEventName: 'Stop', transcriptPath: antigravityTranscript(home, 6) });
    const run = cli(home, ['session-capture', '--mode=session-end', '--hook-protocol=antigravity', `--home=${home}`], {
      stdin
    });
    expect({ ...run, days: dayFiles(home) }).toMatchSnapshot();
  });

  test("Claude Code's launch folder wins over the payload's cwd", () => {
    const home = makeHome('initialized');
    mkdirSync(resolve(home, 'sub'), { recursive: true });
    const run = cli(home, ['session-capture', '--mode=session-end', '--hook-protocol=claude'], {
      stdin: hookPayload(claudeTranscript(home, 4), resolve(home, 'sub')),
      env: { CLAUDE_PROJECT_DIR: home }
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

  test("a queued Claude Code capture is drained at Claude Code's session start", () => {
    const home = makeHome('initialized');
    const queued = { transcriptPath: claudeTranscript(home, 4), cwd: home, sessionId: SESSION_ID, mode: 'session-end' };
    writeFileSync(resolve(home, RUNTIME_DIR, 'capture-pending.jsonl'), `${JSON.stringify(queued)}\n`);
    const run = cli(home, ['session-start', '--hook-protocol=claude'], { env: { CLAUDE_PROJECT_DIR: home } });
    expect(run.exit).toBe(0);
    expect(dayFiles(home)).toMatchSnapshot();
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
