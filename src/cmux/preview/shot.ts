/*
 * `bun run cmux:screenshot [--window-demo] [--out <dir>]` retakes the sidebar's screenshots from a terminal inside
 * cmux: the preview on each page, cropped to the panel, and with --window-demo the whole window too, made-up
 * workspaces and groups beside it. All of it happens in a window this opens and closes; no other window is named.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeFileAtomic } from '@/shared/utils';
import { SIDEBAR_NAME, sidebarFile, sidebarsDir } from '../file';
import { defaultTarget } from '../lifecycle';
import type { StartPage } from '../sidebar/data';
import { buildDemo } from './demo';
import { previewText } from './preview';
import { inNewWindow, runSteps, writePanel, type Step } from './window';

export const PAGES: Readonly<Record<string, StartPage>> = {
  manager: { tab: 'manager' },
  projects: { tab: 'agents', section: 'projects' },
  reports: { tab: 'agents', section: 'reports' },
  goals: { tab: 'agents', section: 'goals' }
};

// cmux redraws a sidebar about a second after its file changes.
const REDRAW = 1500;

/**
 * The steps that ready `window` for the shots: a fixed size, so every run's images match, and the preview on its right.
 */
export const setupSteps = (window: string, sidebar: string): Step[] => [
  { args: ['resize-window', '--window', window, '--width', '1400', '--height', '900'] },
  { args: ['right-sidebar', 'set', 'custom', sidebar, '--window', window] }
];

export const shotStep = (window: string, out: string): Step => ({
  args: ['shot', '--window', window, '--out', out],
  wait: REDRAW
});

if (import.meta.main) {
  const args = process.argv.slice(2);
  const demo = args.includes('--window-demo');
  const outFlag = args.indexOf('--out');
  const out = outFlag === -1 ? mkdtempSync(join(tmpdir(), 'agentlayer-shots-')) : resolve(args[outFlag + 1] ?? '.');
  mkdirSync(out, { recursive: true });
  const name = `${SIDEBAR_NAME}-preview`;
  const preview = sidebarFile(sidebarsDir(), name);
  const own = defaultTarget().own();
  const show = (page: StartPage) => writeFileAtomic(preview, previewText(own, page));
  const raw = mkdtempSync(join(tmpdir(), 'agentlayer-shot-'));
  const homes = mkdtempSync(join('/tmp', 'agentlayer-demo-'));
  const written: string[] = [];
  show(PAGES.manager ?? { tab: 'manager' });
  try {
    await inNewWindow('AgentLayer preview', async (window) => {
      if (demo) {
        await buildDemo(window, homes);
      }
      await runSteps(setupSteps(window, name));
      for (const [page, start] of Object.entries(PAGES)) {
        const full = join(raw, `${page}.png`);
        show(start);
        await runSteps([shotStep(window, full)]);
        const panel = join(out, `cmux-sidebar-${page}.png`);
        writePanel(full, panel);
        written.push(panel);
      }
      if (demo) {
        const full = join(raw, 'workstation.png');
        show(PAGES.projects ?? { tab: 'agents' });
        await runSteps([shotStep(window, full)]);
        const whole = join(out, 'cmux-workstation.png');
        copyFileSync(full, whole);
        written.push(whole);
      }
    });
  } finally {
    rmSync(homes, { recursive: true, force: true });
  }
  console.log(['Wrote:', ...written].join('\n  '));
}
