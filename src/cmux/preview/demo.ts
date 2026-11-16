/*
 * The full-window demo: made-up workspaces and groups in a window the screenshot opened, so its left sidebar shows
 * agents at work without a single real workspace. The build half runs inside that window (its command starts in the
 * demo's first workspace), because `workspace-group create` acts on the window it's called from.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmux, windows, type Step } from './window';

interface DemoWorkspace {
  name: string;
  description: string;
  color: string;
  group: 'Nova' | 'Scout' | '';
  status?: { text: string; icon: string; color: string };
  progress?: { value: number; label: string };
}

// The same story the preview sidebar tells: Nova's support sweep needs you, Scout is fixing the checkout.
export const WORKSPACES: readonly DemoWorkspace[] = [
  {
    name: 'Nova',
    description: 'Support sweep · Morning brief',
    color: 'Indigo',
    group: 'Nova',
    status: { text: 'needs you', icon: 'bell', color: '#FF9F0A' }
  },
  {
    name: 'Morning brief',
    description: 'Ready since 8:30 AM',
    color: 'Indigo',
    group: 'Nova',
    status: { text: 'done', icon: 'checkmark', color: '#34C759' }
  },
  {
    name: 'acme-app',
    description: 'Fix the checkout total',
    color: 'Blue',
    group: 'Scout',
    status: { text: 'working', icon: 'hammer', color: '#4C8DFF' },
    progress: { value: 0.6, label: 'tests' }
  },
  {
    name: 'Release notes',
    description: 'Write the release notes for 2.4',
    color: 'Blue',
    group: 'Scout',
    status: { text: 'queued', icon: 'clock', color: '#8E8E93' }
  },
  { name: 'Downloads', description: 'Rename the photos', color: 'Charcoal', group: '' }
];

const GROUPS = ['Nova', 'Scout'] as const;

/**
 * What makes a workspace look the part: its colour, a status pill and, on one, a progress bar. Every step names the
 * demo window.
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
  ...(demo.status
    ? [
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
      ]
    : []),
  ...(demo.progress
    ? [
        {
          args: [
            'set-progress',
            String(demo.progress.value),
            '--label',
            demo.progress.label,
            '--workspace',
            workspace,
            '--window',
            window
          ]
        }
      ]
    : [])
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
 * reports back the window's own starting workspace goes and Nova is selected. `homes` holds a folder per workspace.
 */
export const buildDemo = async (window: string, homes: string): Promise<void> => {
  const starting = refsIn(cmux('list-workspaces', '--window', window));
  WORKSPACES.forEach(({ name }) => mkdirSync(join(homes, name), { recursive: true }));
  const [nova] = WORKSPACES;
  if (!nova) {
    return;
  }
  // The shell expands CMUX_WORKSPACE_ID to the workspace this command runs in, the build half's own.
  const script = [process.execPath, fileURLToPath(import.meta.url), 'build', window, homes].map(quote).join(' ');
  const build = `${script} "$CMUX_WORKSPACE_ID"`;
  const self = refIn(
    cmux(
      'new-workspace',
      '--window',
      window,
      '--name',
      nova.name,
      '--description',
      nova.description,
      '--cwd',
      join(homes, nova.name),
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

const CHAT = [
  '',
  '  \x1b[1;35m✻ Nova\x1b[0m \x1b[2m· support and planning for Acme\x1b[0m',
  '',
  '  \x1b[2m>\x1b[0m What needs me today?',
  '',
  '  \x1b[32m●\x1b[0m Three things, most urgent first:',
  '',
  '    1. Fix the checkout total \x1b[2m(ac-102)\x1b[0m · \x1b[33mP0\x1b[0m · due tomorrow',
  '    2. The support sweep: two tickets wait on your reply',
  '    3. The morning brief, ready since 8:30 AM',
  '',
  "    I put the checkout fix first on today's list and drafted both replies.",
  "    Say the word and I'll open them.",
  ''
].join('\n');

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
        join(homes, demo.name)
      )
    )
  }));
  const all = [{ demo: WORKSPACES[0], ref: self }, ...created].flatMap(({ demo, ref }) =>
    demo ? [{ demo, ref }] : []
  );
  all.forEach(({ demo, ref }) => decorateSteps(window, ref, demo).forEach(({ args }) => cmux(...args)));
  GROUPS.forEach((group) => {
    const members = all.filter(({ demo }) => demo.group === group).map(({ ref }) => ref);
    cmux('workspace-group', 'create', '--name', group, '--from', members.join(','));
  });
  // The list is the calling window's groups, under that window's ref: the demo window's, here.
  const ref = windows().find((row) => row.id === window)?.ref;
  const listed: unknown = JSON.parse(cmux('workspace-group', 'list', '--json'));
  const inWindow = typeof listed === 'object' && listed !== null && 'window_ref' in listed ? listed.window_ref : '';
  const groups =
    typeof listed === 'object' && listed !== null && 'groups' in listed && Array.isArray(listed.groups)
      ? listed.groups
      : [];
  const names = groups.flatMap((group: unknown) =>
    typeof group === 'object' && group !== null && 'name' in group && typeof group.name === 'string' ? [group.name] : []
  );
  if (!ref || inWindow !== ref || !GROUPS.every((group) => names.includes(group))) {
    throw new Error(
      `the demo groups aren't in the demo window ${ref ?? window}; check cmux workspace-group list --json`
    );
  }
};

if (import.meta.main && process.argv[2] === 'build') {
  const [window = '', homes = '', self = ''] = process.argv.slice(3);
  const state = join(homes, STATE);
  try {
    buildInside(window, homes, self);
    writeFileSync(state, JSON.stringify({ ok: true }));
    console.clear();
    console.log(CHAT);
  } catch (error) {
    writeFileSync(state, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    console.error(error);
  }
  await new Promise(() => undefined);
}
