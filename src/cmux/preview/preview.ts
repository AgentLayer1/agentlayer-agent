import { homeEntry } from '../entry';
import { renderSidebar, type SidebarCode } from '../file';
import type { StartPage } from '../sidebar/data';
import { NOVA_HOME, SCOUT_HOME } from './fixture';
import { ATLAS_HOME, SHOWCASE_ATLAS, SHOWCASE_CMUX_DATA, SHOWCASE_NOVA, SHOWCASE_SCOUT } from './showcase';

/**
 * The sidebar drawing the showcase's invented homes and sessions with a frozen clock, for screenshots, opened
 * on `open`. Parameters shadow cmux's `data` and `cmux` globals, so it never shows real sessions and its taps go nowhere.
 */
export const previewText = (own: SidebarCode, open?: StartPage): string =>
  renderSidebar({
    version: own.version,
    homes: {
      [NOVA_HOME]: homeEntry(NOVA_HOME, SHOWCASE_NOVA),
      [SCOUT_HOME]: homeEntry(SCOUT_HOME, SHOWCASE_SCOUT),
      [ATLAS_HOME]: homeEntry(ATLAS_HOME, SHOWCASE_ATLAS)
    },
    bundle: [
      ...(open ? [`DATA.open = ${JSON.stringify(open)};`] : []),
      `const MOCK = ${JSON.stringify(SHOWCASE_CMUX_DATA)};`,
      '((data, cmux) => {',
      own.bundle,
      '})({ workspaces: () => MOCK.workspaces, groups: () => undefined, clock: () => MOCK.clock }, () => {});',
      ''
    ].join('\n')
  });
