import type { EngineInterface, On } from 'claude-code';

import { cliArgv } from '../shared/cli';
import { showsInRecent } from './paths';

const SIDEBAR_FILE = '.config/cmux/sidebars/agentlayer.js';
const HOME_RECHECK_MS = 60_000;

let homeCache: { home: Promise<string | undefined>; at: number } | undefined;
// One refresh at a time; an edit made while one runs asks for exactly one more, which reads the files after it.
let refreshing: Promise<void> | undefined;
let wanted = false;

// A miss is asked again after a minute, so a folder set up as a home mid-session is picked up.
async function home($: EngineInterface): Promise<string | undefined> {
  const now = await $.clock.now();
  if (homeCache !== undefined && ((await homeCache.home) !== undefined || now - homeCache.at < HOME_RECHECK_MS)) {
    return homeCache.home;
  }
  const lookup = $.process
    .run(cliArgv($.plugin.root, ['ping']), { cwd: await $.session.root() })
    .then(({ exitCode, stdout }) => {
      const parsed: unknown = exitCode === 0 ? JSON.parse(stdout) : undefined;
      return typeof parsed === 'object' &&
        parsed !== null &&
        'ok' in parsed &&
        parsed.ok === true &&
        'home' in parsed &&
        typeof parsed.home === 'string'
        ? parsed.home
        : undefined;
    })
    .catch(() => undefined);
  homeCache = { home: lookup, at: now };
  return lookup;
}

// The home a write landed in, when Recent lists the file and the cmux sidebar is installed to show it. Sessions start
// in their home, so a path outside the session's folder, or one Recent leaves out, costs no call at all.
async function shownHome($: EngineInterface, path: string): Promise<string | undefined> {
  const folder = await $.session.root();
  if (!path.startsWith(`${folder}/`) || !showsInRecent(path.slice(folder.length + 1))) {
    return undefined;
  }
  const [root, userHome] = await Promise.all([home($), $.env.get('HOME')]);
  if (root !== folder || userHome === undefined) {
    return undefined;
  }
  const installed = await $.fs.stat(`${userHome}/${SIDEBAR_FILE}`).then(
    (stat) => stat.kind === 'file',
    () => false
  );
  return installed ? root : undefined;
}

async function drain($: EngineInterface, root: string): Promise<void> {
  wanted = false;
  await $.process
    .run(cliArgv($.plugin.root, ['cmux', 'sidebar', 'refresh', `--home=${root}`]), { cwd: root })
    .catch(() => undefined);
  return wanted ? drain($, root) : undefined;
}

function refresh($: EngineInterface, root: string): void {
  wanted = true;
  if (refreshing === undefined) {
    refreshing = drain($, root).finally(() => {
      refreshing = undefined;
    });
  }
}

export const registerSidebar = (on: On): void => {
  // The sidebar's Recent lists what changed in the home; a session's own edits reach it now, not at the next rebuild.
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const result = await next(e);
    if (result.deny === undefined && result.isError !== true) {
      shownHome($, e.file_path)
        .then((root) => {
          if (root !== undefined) {
            refresh($, root);
          }
        })
        .catch(() => undefined);
    }
    return result;
  });
};
