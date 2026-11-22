import { FOLDERS } from '@/config';
import { CLI_COMMAND } from '@/shared/naming';
import { buildWork } from '@/work/build';
import { cmuxVersion, runCmux } from './app';
import { homeEntry, readHomeState } from './entry';
import {
  defaultTarget,
  installSidebar,
  orderSidebar,
  refreshSidebar,
  removeSidebar,
  type SidebarOrder
} from './lifecycle';

const USAGE = `Usage: ${CLI_COMMAND} cmux sidebar <install|refresh|remove|order <agent>…>`;
const INSTALL = `${CLI_COMMAND} cmux sidebar install`;
const NOT_INSTALLED = `The AgentLayer sidebar isn’t installed. Add this home from a terminal inside cmux with: ${INSTALL}`;

const REFRESHED = {
  'not-installed': NOT_INSTALLED,
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

const ORDERED = (result: SidebarOrder): string => {
  switch (result.kind) {
    case 'not-installed':
      return NOT_INSTALLED;
    case 'unmatched':
      return `No single agent on the sidebar matches ${result.unmatched.join(', ')}. It shows ${result.names.join(', ')}; name an agent, or its home folder when two share a name.`;
    case 'unchanged':
      return `The sidebar already lists ${result.names.join(', ')}.`;
    case 'written':
      return `The sidebar now lists ${result.names.join(', ')}.`;
  }
};

/**
 * `cmux sidebar …`: the cmux pack's verbs. Returns the process exit code.
 */
export const runCmuxCommand = async (command: string | undefined, args: string[]): Promise<number> => {
  const [verb, ...picks] = args.filter((arg) => !arg.startsWith('--'));
  const target = defaultTarget();
  if (command !== 'sidebar') {
    console.error(USAGE);
    return 1;
  }
  if (verb === 'install' || verb === 'refresh') {
    const entry = homeEntry(FOLDERS.HOME, buildWork(), readHomeState());
    if (verb === 'refresh') {
      console.log(REFRESHED[refreshSidebar(FOLDERS.HOME, entry, target)]);
      return 0;
    }
    const result = installSidebar(FOLDERS.HOME, entry, target, { version: cmuxVersion(), run: runCmux });
    (result.ok ? console.log : console.error)(result.message);
    return result.ok ? 0 : 1;
  }
  if (verb === 'order' && picks.length) {
    const result = orderSidebar(picks, target);
    const ok = result.kind === 'written' || result.kind === 'unchanged';
    (ok ? console.log : console.error)(ORDERED(result));
    return ok ? 0 : 1;
  }
  if (verb === 'remove') {
    console.log(REMOVED[removeSidebar(FOLDERS.HOME, target)]);
    return 0;
  }
  console.error(USAGE);
  return 1;
};
