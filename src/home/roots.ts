/**
 * The home of a server whose client names its workspace only through MCP roots: Antigravity starts a plugin's server
 * in the plugin's folder, then answers `roots/list` with the session's workspace folders.
 */
import { homeAbove, loadSettingsEnv, pinHome } from '@/shared/settings-env';
import { fileURLToPath } from 'node:url';

/** The first root that sits in an agent home, or undefined. */
export const homeInRoots = (uris: string[]): string | undefined =>
  uris
    .filter((uri) => uri.startsWith('file://'))
    .map((uri) => homeAbove(fileURLToPath(uri)))
    .find((home) => home !== undefined);

/** Pin the home the roots name and load its settings env; true when one was found. */
export const useHomeInRoots = (uris: string[]): boolean => {
  const home = homeInRoots(uris);
  if (home === undefined) {
    return false;
  }
  pinHome(home);
  loadSettingsEnv(home);
  return true;
};
