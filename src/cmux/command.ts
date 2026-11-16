import { FOLDERS } from '@/config';
import { CLI_COMMAND } from '@/shared/naming';
import { buildWork } from '@/work/build';
import { writeWork } from '@/work/store';
import { cmuxVersion, runCmux } from './app';
import { homeEntry } from './entry';
import { defaultTarget, installSidebar, refreshSidebar, removeSidebar } from './lifecycle';

const USAGE = `Usage: ${CLI_COMMAND} cmux sidebar <install|refresh|remove>`;
const INSTALL = `${CLI_COMMAND} cmux sidebar install`;

const REFRESHED = {
  'not-installed': `The AgentLayer sidebar isn’t installed. Add this home from a terminal inside cmux with: ${INSTALL}`,
  'not-joined': `This home isn’t in the AgentLayer sidebar. Add it from a terminal inside cmux with: ${INSTALL}`,
  unchanged: 'The sidebar is up to date.',
  written: 'The sidebar now shows this home’s latest projects and tasks.'
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
  const [verb] = args.filter((arg) => !arg.startsWith('--'));
  const target = defaultTarget();
  if (command !== 'sidebar') {
    console.error(USAGE);
    return 1;
  }
  if (verb === 'install' || verb === 'refresh') {
    const work = buildWork();
    writeWork(work);
    const entry = homeEntry(FOLDERS.HOME, work);
    if (verb === 'refresh') {
      console.log(REFRESHED[refreshSidebar(FOLDERS.HOME, entry, target)]);
      return 0;
    }
    const result = installSidebar(FOLDERS.HOME, entry, target, { version: cmuxVersion(), run: runCmux });
    (result.ok ? console.log : console.error)(result.message);
    return result.ok ? 0 : 1;
  }
  if (verb === 'remove') {
    console.log(REMOVED[removeSidebar(FOLDERS.HOME, target)]);
    return 0;
  }
  console.error(USAGE);
  return 1;
};
