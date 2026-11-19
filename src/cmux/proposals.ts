import type { ProposalAdapter, StartInput } from '@/proposals/adapter';
import { buildWork } from '@/work/build';
import { readWork } from '@/work/store';
import { callCmux, type CmuxCall } from './app';
import { refreshSidebarQuietly } from './lifecycle';

const PROMPT_VARIABLE = 'AGENT_PROPOSAL_PROMPT';

/**
 * The `cmux new-workspace` call that opens a proposal. The prompt reaches the shell only through its file, named in an
 * environment variable, so neither its text nor the home's path is ever parsed as shell.
 */
const workspaceArgs = ({ home, proposal, promptFile, launcher }: StartInput): string[] => [
  'new-workspace',
  '--cwd',
  home,
  '--name',
  proposal.title,
  '--env',
  `${PROMPT_VARIABLE}=${promptFile}`,
  '--command',
  `${launcher} "$(cat "$${PROMPT_VARIABLE}")"`
];

/**
 * The cmux adapter over a given cmux runner, so a test can watch the calls without cmux.
 */
export const cmuxAdapterWith = (run: (args: string[]) => CmuxCall): ProposalAdapter => ({
  name: 'cmux',
  locate: (env) => {
    const surfaceId = env.CMUX_SURFACE_ID;
    const workspaceId = env.CMUX_WORKSPACE_ID;
    return surfaceId && workspaceId ? { adapter: 'cmux', surfaceId, workspaceId } : null;
  },
  start: (input) => {
    const result = run(workspaceArgs(input));
    if (!result.ok) {
      throw new Error(result.output || 'cmux didn’t open a workspace.');
    }
    return 'Opened it in a new cmux workspace.';
  },
  publish: (home) => {
    refreshSidebarQuietly(home, readWork() ?? buildWork());
  }
});

export const cmuxAdapter = cmuxAdapterWith(callCmux);
