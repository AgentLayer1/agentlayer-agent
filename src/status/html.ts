/**
 * I/O wrapper for the HTML Agent OS dashboard: collect a fresh snapshot,
 * render (html-render.ts, pure), write atomically to `<HOME>/dashboard.html`.
 * Kept separate from the renderer so the rendering stays pure and testable without
 * touching the filesystem.
 */
import { FILES } from '@/config';
import { writeFileAtomic } from '@/shared/utils';
import { writeDashboard, type DashboardCounts } from '@/tasks/dashboard';
import { buildWork } from '@/work/build';
import type { Work } from '@/work/model';
import { writeWork } from '@/work/store';
import { collectStatus } from './collect';
import { writeAttentionPagesSafe } from './attention';
import { renderDashboardHtml } from './html-render';

/** Write the work model, then collect a fresh snapshot of it and write the dashboard to `<HOME>/dashboard.html`. */
export const writeDashboardHtml = async (work: Work = buildWork()): Promise<{ path: string; bytes: number }> => {
  writeWork(work);
  writeAttentionPagesSafe();
  const snapshot = await collectStatus(work);
  const html = renderDashboardHtml(snapshot);
  writeFileAtomic(FILES.DASHBOARD, html);
  // The cmux pack is optional, so the dashboard loads it only here.
  const { refreshSidebarQuietly } = await import('@/cmux/lifecycle');
  refreshSidebarQuietly(snapshot.runtime.home, work);
  return { path: FILES.DASHBOARD, bytes: Buffer.byteLength(html) };
};

/** Rebuild both derived views — TASKS.md first (best-effort), then the HTML
 *  snapshot (the contract). Shared by the `dashboard` MCP tool and the CLI. */
export const rebuildDashboards = async (): Promise<{ path: string; bytes: number; tasks: DashboardCounts | null }> => {
  const work = buildWork();
  let tasks: DashboardCounts | null = null;
  try {
    tasks = writeDashboard(work);
  } catch {
    // TASKS.md is best-effort here — the HTML snapshot is the contract
  }
  return { ...(await writeDashboardHtml(work)), tasks };
};
