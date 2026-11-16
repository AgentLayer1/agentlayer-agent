import { homeEntry } from '../entry';
import { renderSidebar, type SidebarCode } from '../file';
import { CMUX_DATA, NOVA, SCOUT } from './fixture';

/**
 * The sidebar drawing the two invented homes and their invented sessions with a frozen clock, for screenshots.
 * Parameters shadow cmux's `data` and `cmux` globals, so it never shows real sessions and its taps go nowhere.
 */
export const previewText = (own: SidebarCode): string =>
  renderSidebar({
    version: own.version,
    homes: Object.fromEntries([NOVA, SCOUT].map((source) => [source.runtime.home, homeEntry(source)])),
    bundle: [
      `const MOCK = ${JSON.stringify(CMUX_DATA)};`,
      '((data, cmux) => {',
      own.bundle,
      '})({ workspaces: () => MOCK.workspaces, groups: () => undefined, clock: () => MOCK.clock }, () => {});',
      ''
    ].join('\n')
  });
