import { relative } from 'node:path';
import type { ProposalAdapter } from '@/proposals/adapter';
import { promptLaunch, type SessionPlace, type StartInput } from '@/sessions/launch';
import { buildWork } from '@/work/build';
import { callCmux, type CmuxCall } from './app';
import { refreshSidebarQuietly } from './lifecycle';

/**
 * The `cmux new-surface` call that opens a proposal as a focused tab in the workspace the sidebar picked, else the
 * workspace of the session that started it.
 * `new-surface` takes no environment, so the shell reads the prompt from its quoted path relative to the home: neither
 * the prompt's text nor the home's path is parsed as shell.
 */
const surfaceArgs = ({ home, promptFile, launcher }: StartInput, place: SessionPlace): string[] => {
  const promptPath = relative(home, promptFile);
  if (promptPath.startsWith('..')) {
    throw new Error(`The prompt file isn’t a plain path inside the home: ${promptFile}`);
  }
  return [
    'new-surface',
    '--workspace',
    place.workspaceId,
    '--working-directory',
    home,
    '--focus',
    'true',
    '--command',
    promptLaunch(launcher, promptPath)
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
    const args = surfaceArgs(input, place);
    // Selecting first brings the new tab into view; a failed select still opens it.
    run(['select-workspace', '--workspace', place.workspaceId]);
    const result = run(args);
    if (!result.ok) {
      throw new Error(result.output || 'cmux didn’t open a tab.');
    }
    return 'Opened it in a new tab.';
  },
  publish: (home) => {
    // A fresh scan, not the saved model: a summary or task changed since the last dashboard rebuild would be undone.
    refreshSidebarQuietly(home, buildWork());
  }
});

export const cmuxAdapter = cmuxAdapterWith(callCmux);
