import { mock } from 'claude-code/testing';
import type { Engine, MockClock } from 'claude-code/testing';
import type { AgentInfo, FsStat, On, ProcessRunResult } from 'claude-code';

import type { HeartbeatStatus } from '../heartbeat/beat';
import type { Notice } from '../types';

/**
 * The plugin's name and its MCP server's key as the manifest gives them, which a test has no
 * filesystem to read; every name a test spells (commands, tools) derives from them.
 */
export const PLUGIN = 'agentlayer' as const;
export const AGENT = 'agent' as const;
export const STATS_TOOL = `mcp__${PLUGIN}__sync_stats` as const;

export const HOME = '/fixture/home';
export const USER_HOME = '/fixture/user';
/** The home's folder of session transcripts, as Claude Code keeps it under the user's config. */
export const PROJECTS = `${USER_HOME}/.claude/projects/-fixture-home`;
export const CODE = '/fixture/code';
/**
 * How long the fake person takes to answer a question.
 */
export const QUESTION_MS = 30_000;
/**
 * How long the fake Skill tool takes, so a test can expand the skill while the call is open.
 */
export const SKILL_MS = 1_000;
export const NOW = Date.parse('2026-03-10T09:00:00+08:00');

const taskPath = (id: string): string => `${HOME}/projects/acme/tasks/${id}-fixture task.md`;

export const TASKS = [
  { id: 'ac-001', title: 'Licence fixture', status: 'active', priority: 'P1', due: '2026-03-01' },
  { id: 'ac-002', title: 'Due today fixture', status: 'open', priority: 'P2', due: '2026-03-10' },
  { id: 'ac-003', title: 'Closed fixture', status: 'done', priority: 'P0', due: '2026-02-01' },
  { id: 'ac-005', title: 'Urgent fixture', status: 'open', priority: 'P0', due: '2026-03-08' },
  { id: 'ac-006', title: 'Blocked fixture', status: 'blocked', priority: 'P0' },
  { id: 'bx-001', title: 'Acme fixture', status: 'open', priority: 'P0' }
].map((task) => ({ ...task, project: 'acme', filePath: taskPath(task.id) }));

/**
 * A fake machine: files and folders by absolute path, and the CLI's answers, mutable mid-test.
 */
export interface FakeMachine {
  files: Record<string, string>;
  folders: string[];
  compilePending: { sessions: number; feedback: number; inbox: number };
  taskScan: { overdue: number; stale: number; dueSoon: number };
  brainStale: number;
  store: Map<string, unknown>;
  argv: string[][];
  cwd: (string | undefined)[];
  toolText: Record<string, string>;
  fsCalls: string[];
  notices: Notice[];
  /** What `heartbeat status --json` is made from: the heartbeat, how many proposals show, and the brain. */
  status: {
    target: number;
    showing: number;
    heartbeat: HeartbeatStatus['heartbeat'];
    refreshedAt?: string;
    refreshDue?: boolean;
  };
  /** The notes room the status reports; unset, there is none and no scouting runs. */
  notesRoom?: number;
  /** False when the home hasn't turned scouting on (`AGENT_NOTES_SCOUT=true`); unset here, it is on. */
  notesScout?: boolean;
  /** What `notes brief --json` answers; unset, the brain lens, which runs in the heartbeat. */
  notesBrief?: { lens: string; web: boolean; prompt: string };
  toasts: string[];
  /** What `$.ui.copy` put on the clipboard. */
  copied: string[];
  suggestions: string[];
  commands: string[];
  /** What each command in `commands` was run with, in the same order. */
  commandArgs: string[];
  /** CLI calls (`task query`) that exit 1. */
  failing: string[];
  /** CLI calls that never answer, as when the engine stops a clock mid-tick. */
  hanging: string[];
  /** Status changes the CLI made (`task close`, `task update --status`), by task id. */
  statuses: Record<string, string>;
  /** The folder the session started in. */
  root: string;
  /** The subagents `$.agent.list()` answers; a spawn adds one running. */
  agents: AgentInfo[];
  /** What each spawn was given: its description and its prompt. */
  spawned: { description: string; prompt: string }[];
  /** What `$.session.id()` answers; a test changes it to stand for another conversation. */
  sessionId: string;
  /** What `ping` says about the folder: false outside an agent home. */
  isHome: boolean;
  /** The files a shell command writes, by the command's exact text; each gets the clock's time as its modified time. */
  shellWrites: Record<string, string[]>;
  /** Modified times by path; a file not listed was last modified at 0. */
  mtimes: Record<string, number>;
  /** What `$.session.info()` names as this conversation's transcript; '' for a session that keeps none. */
  transcriptPath: string;
  /** The last write to each other session's transcript in the home's folder; left unset, one written just now. */
  transcripts?: Record<string, number>;
}

export const machine = (overrides: Partial<FakeMachine> = {}): FakeMachine => ({
  files: {
    [`${HOME}/IDENTITY.md`]: '- **Name:** Ada\n- **Emoji:** 🦊\n',
    [`${HOME}/.data/cadence.json`]: JSON.stringify({ sync: '2026-03-06T09:00:00+08:00' }),
    [`${HOME}/.state/version.json`]: JSON.stringify({ plugin: PLUGIN })
  },
  folders: [],
  compilePending: { sessions: 3, feedback: 1, inbox: 0 },
  taskScan: { overdue: 7, stale: 12, dueSoon: 2 },
  brainStale: 12,
  store: new Map(),
  argv: [],
  cwd: [],
  toolText: {},
  fsCalls: [],
  notices: [],
  status: { target: 5, showing: 0, heartbeat: null },
  toasts: [],
  copied: [],
  suggestions: [],
  commands: [],
  commandArgs: [],
  failing: [],
  hanging: [],
  statuses: {},
  root: HOME,
  agents: [],
  spawned: [],
  sessionId: 'session-1',
  isHome: true,
  shellWrites: {},
  mtimes: {},
  transcriptPath: `${PROJECTS}/session-1.jsonl`,
  ...overrides
});

const ran = (exitCode: number, stdout: string, stderr = ''): { value: ProcessRunResult } => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false }
});

const stat = (kind: FsStat['kind'], mtimeMs = 0): { value: FsStat } => ({
  value: { kind, size: 0, mtimeMs, isLink: false }
});

// A real filesystem resolves '.' and '..' segments, so the fake does too.
const resolved = (path: string): string =>
  `/${path
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .reduce<string[]>((parts, segment) => (segment === '..' ? parts.slice(0, -1) : [...parts, segment]), [])
    .join('/')}`;

const items = (length: number): string[] => Array.from({ length }, (_unused, index) => `item-${index}`);

const cliAnswer = (host: FakeMachine, args: string): { value: ProcessRunResult } => {
  if (host.failing.includes(args)) {
    return ran(1, '', `${args} failed`);
  }
  if (args === 'ping') {
    return ran(
      0,
      JSON.stringify({ ok: host.isHome, home: HOME, data: `${HOME}/.data`, timezone: 'Asia/Kuala_Lumpur' })
    );
  }
  const tasks = TASKS.map((task) => ({ ...task, status: host.statuses[task.id] ?? task.status }));
  if (args === 'task query') {
    return ran(0, JSON.stringify(tasks));
  }
  const [verb, id, flag] = args.split(' ').slice(1);
  const task = tasks.find((item) => item.id === id);
  if (args.startsWith('task ') && verb !== 'scan' && task === undefined) {
    return ran(1, '', `Task not found: ${id}`);
  }
  if (verb === 'get' && task) {
    return ran(
      0,
      JSON.stringify({
        frontmatter: task,
        description: `**Bug.** The \`${task.id}\` [fixture](https://example.com) breaks.\n\nSecond paragraph.`,
        checklist: [{ checked: true }, { checked: false }, { checked: false }, { checked: false }],
        filePath: task.filePath
      })
    );
  }
  if (verb === 'close' && id) {
    host.statuses[id] = 'done';
  }
  if (verb === 'update' && id && flag?.startsWith('--status=')) {
    host.statuses[id] = flag.slice('--status='.length);
  }
  if (args === 'compile status') {
    return ran(0, JSON.stringify({ pending: host.compilePending }));
  }
  if (args === 'task scan') {
    return ran(
      0,
      JSON.stringify({
        overdue: items(host.taskScan.overdue),
        stale: items(host.taskScan.stale),
        dueSoon: items(host.taskScan.dueSoon)
      })
    );
  }
  if (args === 'notes brief --json') {
    return ran(0, JSON.stringify(host.notesBrief ?? { lens: 'brain', web: false, prompt: '' }));
  }
  if (args === 'heartbeat status --json') {
    const { target, showing, heartbeat, refreshedAt = '', refreshDue = false } = host.status;
    const notes = { cap: 3, room: host.notesRoom ?? 0, today: 3 - (host.notesRoom ?? 0), scout: host.notesScout ?? true };
    return ran(
      0,
      JSON.stringify({
        heartbeat,
        timezone: 'Asia/Kuala_Lumpur',
        refreshedAt,
        refreshDue,
        proposals: { target, room: Math.max(0, target - showing), showing },
        notes
      })
    );
  }
  // The CLI's heartbeat binding, kept so a test sees the owner and interval it was given.
  const binding = /^heartbeat bind --owner=(\S+)(?: --every=(\d+)\s*(h|m))?/.exec(args);
  if (binding) {
    const minutes = Number(binding[2] ?? 55) * (binding[3] === 'h' ? 60 : 1);
    host.status.heartbeat = { owner: binding[1] ?? '', everyMinutes: minutes };
  }
  if (args === 'heartbeat off') {
    host.status.heartbeat = null;
  }
  const release = /^heartbeat release --owner=(\S+)$/.exec(args);
  if (release && host.status.heartbeat?.owner === release[1]) {
    host.status.heartbeat = null;
  }
  if (/^(heartbeat|proposals|messages) /.test(args)) {
    return ran(0, `ran ${args}`);
  }
  if (args.startsWith('notices')) {
    return ran(0, JSON.stringify(host.notices));
  }
  if (args.startsWith('capture')) {
    return ran(0, JSON.stringify({ ok: true, relPath: 'knowledge/raw/inbox/fixture.md', duplicate: false }));
  }
  return ran(0, JSON.stringify({ ok: true }));
};

/**
 * Stands in for the host beneath the plugin: the plugin CLI, settings, files, clock and store.
 */
export interface FakeHost extends FakeMachine {
  clock: MockClock;
}

export const fakeHost = (on: On, host: FakeMachine = machine()): FakeHost => {
  const clock = mock.clock(on, { now: NOW });
  on('session.root', () => ({ value: host.root }));
  on('session.id', () => ({ value: host.sessionId }));
  on('session.info', () => ({ value: { transcriptPath: host.transcriptPath } }));
  // This conversation's own transcript and a subagent folder ride along, as in a real project folder.
  on('fs.list', (_$, e) => {
    if (e.path !== PROJECTS) {
      throw new Error(`ENOENT ${e.path}`);
    }
    const others = Object.entries(host.transcripts ?? { 'session-9': clock.now() });
    return {
      value: [
        ...[[host.sessionId, clock.now()] as const, ...others].map(([id, mtimeMs]) => ({
          name: `${id}.jsonl`,
          kind: 'file' as const,
          size: 1,
          mtimeMs,
          isLink: false
        })),
        { name: 'session-9', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }
      ]
    };
  });
  on('env.get', () => ({ value: USER_HOME }));
  on('settings.read', () => ({ value: { permissions: { additionalDirectories: [CODE, '~/granted'] } } }));
  on('process.run', (_$, e) => {
    host.argv.push([...e.argv]);
    host.cwd.push(e.init?.cwd);
    if (e.argv[1]?.endsWith('/brain-audit.ts')) {
      return ran(0, JSON.stringify({ counts: { staleTasks: host.brainStale, oldestWaiting: '2026-01-01' } }));
    }
    const args = e.argv.slice(2).join(' ');
    if (host.hanging.includes(args)) {
      return new Promise<never>(() => {});
    }
    return cliAnswer(host, args);
  });
  on('fs.read', (_$, e) => {
    host.fsCalls.push(e.path);
    const text = host.files[resolved(e.path)];
    if (text === undefined) {
      throw new Error(`ENOENT ${e.path}`);
    }
    return { value: text };
  });
  on('fs.stat', (_$, e) => {
    host.fsCalls.push(e.path);
    if (host.folders.includes(resolved(e.path))) {
      return stat('dir');
    }
    if (host.files[resolved(e.path)] !== undefined) {
      return stat('file', host.mtimes[resolved(e.path)]);
    }
    throw new Error(`ENOENT ${e.path}`);
  });
  on('store.get', (_$, e) => ({ value: host.store.get(e.key) }));
  on('store.set', (_$, e) => {
    host.store.set(e.key, e.value);
    return { value: undefined };
  });
  on('store.delete', (_$, e) => {
    host.store.delete(e.key);
    return { value: undefined };
  });
  on('store.keys', () => ({ value: [...host.store.keys()] }));
  on('tool.list', () => ({ value: [{ name: STATS_TOOL, description: 'stats', mcp: true }] }));
  on('tool.call', async (_$, e) => {
    if (e.tool === 'AskUserQuestion') {
      await clock.sleep(QUESTION_MS);
    }
    if (e.tool === 'Skill') {
      await clock.sleep(SKILL_MS);
    }
    if (e.tool === 'Bash') {
      (host.shellWrites[e.command] ?? []).forEach((path) => {
        host.files[path] = host.files[path] ?? 'written';
        host.mtimes[path] = clock.now();
      });
    }
    return { result: 'ok', text: host.toolText[e.tool] ?? '{}' };
  });
  on('skill.prompt', (_$, e) => ({ text: e.text }));
  on('agent.spawn', (_$, e) => {
    host.agents.push({ id: e.description, description: e.description, type: e.subagentType, status: 'running' });
    host.spawned.push({ description: e.description, prompt: e.prompt });
    return { model: 'fake', agentId: e.description };
  });
  on('agent.list', () => ({ value: host.agents }));
  on('agent.offer', () => ({ isOffered: true }));
  on('agent.report', (_$, e) => ({ text: e.text }));
  on('turn.complete', () => ({ text: '', reason: 'answer' as const }));
  on('session.compact', (_$, e) => ({ messages: e.messages }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('command.register', (_$, e) => ({ value: { command: e.name } }));
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }));
  on('ui.toast', (_$, e) => {
    host.toasts.push(e.text);
    return { value: undefined };
  });
  on('ui.copy', (_$, e) => {
    host.copied.push(e.text);
    return { value: { isCopied: true as const } };
  });
  on('prompt.suggest', (_$, e) => {
    host.suggestions.push(e.text);
    return { isShown: true };
  });
  on('prompt.autocomplete', () => ({ suggestions: [] }));
  on('command.run', (_$, e) => {
    host.commands.push(e.command);
    host.commandArgs.push(e.args);
    return {};
  });
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box' as const }));
  return Object.assign(host, { clock });
};

export const run = ($: Engine, command: string, args = '') =>
  $.command.run({
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 }
  });

export const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 12,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 12 },
  view: {}
};
