import { relative } from 'node:path';
import type { ProposalAdapter, SessionPlace, StartInput } from '@/proposals/adapter';
import { buildWork } from '@/work/build';
import { readWork } from '@/work/store';
import { callCmux, type CmuxCall } from './app';
import { refreshSidebarQuietly } from './lifecycle';

/**
 * The `cmux new-surface` call that opens a proposal as a tab in the workspace of the session that started it. `new-surface` takes no environment,
 * so the shell reads the prompt from its path relative to the home: neither the prompt's text nor the home's path is
 * ever parsed as shell.
 */
const surfaceArgs = ({ home, promptFile, launcher }: StartInput, place: SessionPlace): string[] => {
  const promptPath = relative(home, promptFile);
  if (promptPath.startsWith('..') || promptPath.includes("'")) {
    throw new Error(`The prompt file isn’t a plain path inside the home: ${promptFile}`);
  }
  return [
    'new-surface',
    '--workspace',
    place.workspaceId,
    '--working-directory',
    home,
    '--command',
    `${launcher} "$(cat '${promptPath}')"`
  ];
};

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
  start: (input, place) => {
    const result = run(surfaceArgs(input, place));
    if (!result.ok) {
      throw new Error(result.output || 'cmux didn’t open a tab.');
    }
    return 'Opened it in a new tab.';
  },
  publish: (home) => {
    refreshSidebarQuietly(home, readWork() ?? buildWork());
  }
});

export const cmuxAdapter = cmuxAdapterWith(callCmux);
