import { FOLDERS, LAUNCHER } from '@/config';
import { CLI_COMMAND } from '@/shared/naming';
import { collectStatus } from '@/status/collect';
import { cmuxVersion, runCmux } from './app';
import { homeEntry } from './entry';
import { SIDEBAR_NAME, sidebarFile } from './file';
import { defaultTarget, installSidebar, previewSidebar, refreshSidebar, removeSidebar } from './lifecycle';

const USAGE = `Usage: ${CLI_COMMAND} cmux sidebar <install|refresh|remove|preview [path]>`;
const INSTALL = `${CLI_COMMAND} cmux sidebar install`;

const REFRESHED = {
  'not-installed': `The AgentLayer sidebar isn’t installed. Add this home from a terminal inside cmux with: ${INSTALL}`,
  'not-joined': `This home isn’t in the AgentLayer sidebar. Add it from a terminal inside cmux with: ${INSTALL}`,
  unchanged: 'The sidebar is up to date.',
  written: 'The sidebar now shows this home’s latest projects and pins.'
} as const;

const REMOVED = {
  'not-installed': 'The AgentLayer sidebar isn’t installed.',
  'not-joined': 'This home isn’t in the AgentLayer sidebar.',
  removed: 'This home is out of the AgentLayer sidebar; the other homes stay.',
  'removed-file': `This was the sidebar's last home, so it's deleted. Pick another right sidebar with: cmux right-sidebar set files`
} as const;

/**
 * `cmux sidebar …`: the cmux pack's verbs. Returns the process exit code.
 */
export const runCmuxCommand = async (command: string | undefined, args: string[]): Promise<number> => {
  const [verb, path] = args.filter((arg) => !arg.startsWith('--'));
  const target = defaultTarget();
  if (command !== 'sidebar') {
    console.error(USAGE);
    return 1;
  }
  if (verb === 'install' || verb === 'refresh') {
    const snapshot = await collectStatus();
    const entry = homeEntry(snapshot, LAUNCHER);
    if (verb === 'refresh') {
      console.log(REFRESHED[refreshSidebar(snapshot.runtime.home, entry, target)]);
      return 0;
    }
    const result = installSidebar(snapshot.runtime.home, entry, target, { version: cmuxVersion(), run: runCmux });
    (result.ok ? console.log : console.error)(result.message);
    return result.ok ? 0 : 1;
  }
  if (verb === 'remove') {
    console.log(REMOVED[removeSidebar(FOLDERS.HOME, target)]);
    return 0;
  }
  if (verb === 'preview') {
    const out = path ?? sidebarFile(target.dir, `${SIDEBAR_NAME}-preview`);
    previewSidebar(out, target.own());
    console.log(
      path ? `Wrote ${out}.` : `Wrote ${out}. Show it with: cmux right-sidebar set custom ${SIDEBAR_NAME}-preview`
    );
    return 0;
  }
  console.error(USAGE);
  return 1;
};
