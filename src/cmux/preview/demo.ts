/*
 * The full-window demo: made-up workspaces and groups in a window the screenshot opened, so its left sidebar shows
 * agents at work without a single real workspace. The build half runs inside that window (its command starts in the
 * demo's first workspace), because `workspace-group create` acts on the window it's called from.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '@/shared/json-block';
import { AGENTS } from './showcase';
import { cmux, windowRows, type Step } from './window';

interface DemoWorkspace {
  name: string;
  description: string;
  color: string;
  /**
   * The group's name, the agent's emoji and name, as in the sidebar's agent chips.
   */
  group: string;
  /**
   * The agent's folder, `Agents/<name>` with no emoji, which all its workspaces sit in; the sidebar shows its last two
   * parts, as it shows `…/Agents/<name>` for a real home.
   */
  folder: string;
  status: { text: string; icon: string; color: string };
}

const STATUS = {
  needs_input: { text: 'needs you', icon: 'bell', color: '#FF9F0A' },
  working: { text: 'working', icon: 'hammer', color: '#4C8DFF' },
  idle: { text: 'idle', icon: 'moon', color: '#8E8E93' },
  ended: { text: 'done', icon: 'checkmark', color: '#34C759' }
} as const;

// A group per agent, named after it, holding its own workspace and the ones for its kinds of work, all in the
// agent's folder, as a real agent's workspaces sit in its home.
export const WORKSPACES: readonly DemoWorkspace[] = AGENTS.flatMap((agent) =>
  agent.workspaces.map((workspace) => ({
    name: workspace.title,
    description: workspace.description,
    color: agent.color.named,
    group: `${agent.emoji} ${agent.name}`,
    folder: join('Agents', agent.name),
    status: STATUS[workspace.sessions[0]?.status ?? 'idle']
  }))
);

const GROUPS = AGENTS.map((agent) => `${agent.emoji} ${agent.name}`);

// The build runs in the first agent's own workspace, which the screenshot then shows with its chat.
const lead = (): DemoWorkspace => {
  const [first] = WORKSPACES;
  if (!first) {
    throw new Error('the showcase has no workspaces');
  }
  return first;
};

/**
 * What makes a workspace look the part: its agent's colour and a status pill. Every step names the demo window.
 */
export const decorateSteps = (window: string, workspace: string, demo: DemoWorkspace): Step[] => [
  {
    args: [
      'workspace-action',
      '--action',
      'set-color',
      '--color',
      demo.color,
      '--workspace',
      workspace,
      '--window',
      window
    ]
  },
  {
    args: [
      'set-status',
      'agent',
      demo.status.text,
      '--icon',
      demo.status.icon,
      '--color',
      demo.status.color,
      '--workspace',
      workspace,
      '--window',
      window
    ]
  }
];

const REF = /workspace:\d+|[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;

const refIn = (output: string): string => {
  const ref = output.match(REF)?.[0];
  if (!ref) {
    throw new Error(`no workspace in cmux's reply: ${output.trim()}`);
  }
  return ref;
};

const refsIn = (output: string): string[] => output.match(new RegExp(REF.source, 'gi')) ?? [];

const STATE = 'demo-state.json';
const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;

/**
 * Builds the demo in `window` (main half): its first workspace runs this file's build half there, and once that
 * reports back the window's own starting workspace goes and Nova is selected. `homes` holds a folder per agent.
 */
export const buildDemo = async (window: string, homes: string): Promise<void> => {
  const starting = refsIn(cmux('list-workspaces', '--window', window));
  WORKSPACES.forEach(({ folder }) => mkdirSync(join(homes, folder), { recursive: true }));
  // The shell expands CMUX_WORKSPACE_ID to the workspace this command runs in, the build half's own.
  const script = [process.execPath, fileURLToPath(import.meta.url), 'build', window, homes].map(quote).join(' ');
  const build = `${script} "$CMUX_WORKSPACE_ID"`;
  const self = refIn(
    cmux(
      'new-workspace',
      '--window',
      window,
      '--name',
      lead().name,
      '--description',
      lead().description,
      '--cwd',
      join(homes, lead().folder),
      '--command',
      build
    )
  );
  const state = join(homes, STATE);
  const reported = async (tries: number): Promise<{ ok: boolean; error?: string }> => {
    if (existsSync(state)) {
      return JSON.parse(readFileSync(state, 'utf8'));
    }
    if (tries === 0) {
      return { ok: false, error: 'the build in the demo window never reported back' };
    }
    await Bun.sleep(250);
    return reported(tries - 1);
  };
  const result = await reported(120);
  if (!result.ok) {
    throw new Error(`demo build failed: ${result.error ?? 'no reason given'}`);
  }
  starting.forEach((workspace) => cmux('close-workspace', '--workspace', workspace, '--window', window));
  cmux('select-workspace', '--workspace', self, '--window', window);
};

const [DIM, BOLD, RESET] = ['\x1b[2m', '\x1b[1m', '\x1b[0m'];
const [GREEN, ORANGE, PINK, BLUE] = ['\x1b[32m', '\x1b[33m', '\x1b[35m', '\x1b[34m'];

const CONVERSATION = [
  '',
  `  ${PINK}${BOLD}✻ Nova${RESET} ${DIM}· support and operations for Acme · 🦄${RESET}`,
  '',
  `  ${DIM}>${RESET} What needs me today?`,
  '',
  `  ${GREEN}●${RESET} Checking today's tasks, the support queue and the overnight reports.`,
  '',
  `  ${GREEN}●${RESET} ${BOLD}task_scan${RESET}(all projects)`,
  `    ${DIM}└ 9 live tasks · 1 overdue · 2 due this week${RESET}`,
  `  ${GREEN}●${RESET} ${BOLD}helpdesk_tickets${RESET}(waiting on you)`,
  `    ${DIM}└ 2 tickets: #4812 partial refund, #4815 partial refund${RESET}`,
  `  ${GREEN}●${RESET} ${BOLD}Read${RESET}(reports/briefings/2026-11-09-0830-morning.md)`,
  `    ${DIM}└ Read 64 lines${RESET}`,
  '',
  `  ${GREEN}●${RESET} Three things, most urgent first:`,
  '',
  `    1. ${BOLD}Fix the checkout total${RESET} ${DIM}(ac-102)${RESET} · ${ORANGE}P0${RESET} · due tomorrow`,
  `       Scout is on it in acme-app; the checkout tests are running.`,
  `    2. ${BOLD}Two partial refund tickets${RESET} wait on your reply`,
  `       I drafted both replies in Support Desk, citing the refund policy.`,
  `    3. ${BOLD}The invoice export${RESET} ${DIM}(ac-101)${RESET} is two days overdue`,
  `       I moved it to tomorrow's plan and told the customer it ships Wednesday.`,
  '',
  `    ${BOLD}Today${RESET}`,
  `    ${GREEN}☒${RESET} ${DIM}Read the morning brief${RESET}`,
  `    ☐ Answer the refund tickets`,
  `    ☐ Review PR 412 ${DIM}(Scout flagged one rounding case)${RESET}`,
  `    ☐ Chase Atlas's two missing receipts`,
  '',
  `  ${DIM}>${RESET} Send the refund replies, then open PR 412`,
  '',
  `  ${GREEN}●${RESET} ${BOLD}helpdesk_note${RESET}(#4812, #4815)`,
  `    ${DIM}└ 2 replies sent${RESET}`,
  `  ${GREEN}●${RESET} Both replies are out. Opening PR 412 in Code Reviews.`,
  '',
  `  ${PINK}✻${RESET} ${DIM}Reviewing PR 412… (14s · ↓ 2.1k tokens)${RESET}`
];

// The prompt box and status line a session keeps at the bottom of its terminal.
const FOOTER = (width: number) => [
  `${DIM}${'─'.repeat(width)}${RESET}`,
  ` ${DIM}>${RESET} `,
  `${DIM}${'─'.repeat(width)}${RESET}`,
  `  ${PINK}🦄 Nova${RESET}  ${DIM}│${RESET}  ${BLUE}main${RESET}  ${DIM}│${RESET}  ${GREEN}5 tasks today${RESET}  ${DIM}│${RESET}  ${ORANGE}2 need you${RESET}`
];

/**
 * The mock session filling the demo's terminal, its prompt box on the bottom rows as in a real one.
 */
const chat = (rows: number, columns: number): string => {
  const footer = FOOTER(Math.max(20, columns - 2));
  const gap = Math.max(0, rows - CONVERSATION.length - footer.length - 1);
  return [...CONVERSATION, ...Array.from({ length: gap }, () => ''), ...footer].join('\n');
};

// The build half, inside the demo window: refuses unless this terminal is in it.
const buildInside = (window: string, homes: string, self: string): void => {
  const demoWorkspaces = cmux('--id-format', 'both', 'list-workspaces', '--window', window);
  if (!self || !demoWorkspaces.includes(self)) {
    throw new Error(`this terminal isn't in the demo window ${window}`);
  }
  const created = WORKSPACES.slice(1).map((demo) => ({
    demo,
    ref: refIn(
      cmux(
        'new-workspace',
        '--window',
        window,
        '--name',
        demo.name,
        '--description',
        demo.description,
        '--cwd',
        join(homes, demo.folder)
      )
    )
  }));
  const all = [{ demo: lead(), ref: self }, ...created];
  all.forEach(({ demo, ref }) => decorateSteps(window, ref, demo).forEach(({ args }) => cmux(...args)));
  // cmux puts each new workspace and group at the top, so the order is set outright, then the groups go in last first.
  cmux('reorder-workspaces', '--order', all.map(({ ref }) => ref).join(','), '--window', window);
  GROUPS.toReversed().forEach((group) => {
    const members = all.filter(({ demo }) => demo.group === group).map(({ ref }) => ref);
    cmux('workspace-group', 'create', '--name', group, '--from', members.join(','));
  });
  // The list is the calling window's groups, under that window's ref: the demo window's, here.
  const ref = windowRows().find((row) => row.id === window)?.ref;
  const listed: unknown = JSON.parse(cmux('workspace-group', 'list', '--json'));
  const groups = isRecord(listed) && Array.isArray(listed.groups) ? listed.groups : [];
  const names = groups.map((group: unknown) => (isRecord(group) ? group.name : undefined));
  if (
    typeof ref !== 'string' ||
    !isRecord(listed) ||
    listed.window_ref !== ref ||
    !GROUPS.every((group) => names.includes(group))
  ) {
    throw new Error(`the demo groups aren't in the demo window ${window}; check cmux workspace-group list --json`);
  }
};

if (import.meta.main && process.argv[2] === 'build') {
  const [window = '', homes = '', self = ''] = process.argv.slice(3);
  const state = join(homes, STATE);
  try {
    buildInside(window, homes, self);
    writeFileSync(state, JSON.stringify({ ok: true }));
    // The tab takes the terminal's title, so naming it hides the command line, and the path to bun with it.
    process.stdout.write('\x1b]0;support-sweep\x07\x1b[?25l');
    console.clear();
    process.stdout.write(chat(process.stdout.rows || 40, process.stdout.columns || 100));
  } catch (error) {
    writeFileSync(state, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    console.error(error);
  }
  await new Promise(() => undefined);
}
