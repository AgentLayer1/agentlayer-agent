/**
 * I/O wrapper for the HTML Agent OS dashboard: collect a fresh snapshot,
 * render (html-render.ts, pure), write atomically to `<HOME>/dashboard.html`.
 * Kept separate from the renderer so the rendering stays pure and testable without
 * touching the filesystem.
 */
import type { RefreshResult } from '@/cmux/lifecycle';
import { FILES, FOLDERS } from '@/config';
import { writeFileAtomic } from '@/shared/utils';
import { writeDashboard, type DashboardCounts } from '@/tasks/dashboard';
import { buildWork, readTasks } from '@/work/build';
import { writeWork } from '@/work/store';
import { collectStatus } from './collect';
import { writeAttentionPagesSafe } from './attention';
import { renderDashboardHtml } from './html-render';

interface Written {
  path: string;
  bytes: number;
  sidebar: RefreshResult | 'failed';
}

const writeNow = async (): Promise<Written> => {
  const work = buildWork();
  writeWork(work);
  writeAttentionPagesSafe(work);
  const snapshot = await collectStatus(work);
  const html = renderDashboardHtml(snapshot);
  writeFileAtomic(FILES.DASHBOARD, html);
  // The cmux pack is optional, so the dashboard loads it only here.
  const { refreshSidebarQuietly } = await import('@/cmux/lifecycle');
  const sidebar = refreshSidebarQuietly(FOLDERS.HOME, work);
  return { path: FILES.DASHBOARD, bytes: Buffer.byteLength(html), sidebar };
};

let previous: Promise<unknown> = Promise.resolve();
let waiting: Promise<Written> | null = null;

/**
 * Writes `<HOME>/dashboard.html`, with `.state/work.json`, the attention pages and the cmux sidebar, from the files
 * as they are when the write starts. Writes run one at a time, so an older one never lands after a newer one, and a
 * request made while one waits to start shares it: that write reads the files after the request anyway.
 */
export const writeDashboardHtml = (): Promise<Written> => {
  if (waiting) {
    return waiting;
  }
  const run = previous.then(() => {
    waiting = null;
    return writeNow();
  });
  waiting = run;
  previous = run.catch(() => undefined);
  return run;
};

/** Rebuild both derived views — TASKS.md first (best-effort), then the HTML
 *  snapshot (the contract). Shared by the `dashboard` MCP tool and the CLI. */
export const rebuildDashboards = async (): Promise<Written & { tasks: DashboardCounts | null }> => {
  let tasks: DashboardCounts | null = null;
  try {
    tasks = writeDashboard(readTasks());
  } catch {
    // TASKS.md is best-effort here — the HTML snapshot is the contract
  }
  return { ...(await writeDashboardHtml()), tasks };
};
