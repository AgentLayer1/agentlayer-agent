import { homeEntry } from '../entry';
import { renderSidebar, type SidebarCode } from '../file';
import type { StartPage } from '../sidebar/data';
import { CMUX_DATA, NOVA, NOVA_HOME, SCOUT, SCOUT_HOME } from './fixture';

/**
 * The sidebar drawing the two invented homes and their invented sessions with a frozen clock, for screenshots.
 * Parameters shadow cmux's `data` and `cmux` globals, so it never shows real sessions and its taps go nowhere.
 */
export const previewText = (own: SidebarCode, open?: StartPage): string =>
  renderSidebar({
    version: own.version,
    open,
    homes: { [NOVA_HOME]: homeEntry(NOVA_HOME, NOVA), [SCOUT_HOME]: homeEntry(SCOUT_HOME, SCOUT) },
    bundle: [
      `const MOCK = ${JSON.stringify(CMUX_DATA)};`,
      '((data, cmux) => {',
      own.bundle,
      '})({ workspaces: () => MOCK.workspaces, groups: () => undefined, clock: () => MOCK.clock }, () => {});',
      ''
    ].join('\n')
  });
