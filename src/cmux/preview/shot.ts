/*
 * `bun run cmux:screenshot [--window-demo] [--out <dir>] [--appearance dark|light|both]` retakes the sidebar's
 * screenshots from a terminal inside cmux: the preview on each page, cropped to the panel, and with --window-demo the
 * whole window on Sessions and on Projects too, made-up workspaces and groups beside it. Each is shot in dark and in
 * light mode (light ones end in `-light`) unless --appearance picks one. All of it happens in a window this opens and
 * closes; no other window is named, though every cmux window follows the appearance for the run (see appearance.ts).
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeFileAtomic } from '@/shared/utils';
import { SIDEBAR_NAME, sidebarFile, sidebarsDir } from '../file';
import { defaultTarget } from '../lifecycle';
import type { StartPage } from '../sidebar/data';
import { APPEARANCES, keepingAppearance } from './appearance';
import { buildDemo } from './demo';
import { previewText } from './preview';
import { inNewWindow, runSteps, writePanel, type Step } from './window';

export const PAGES = {
  manager: { tab: 'sessions' },
  projects: { tab: 'projects', expanded: ['tasks', 'support-desk'] },
  reports: { tab: 'reports' },
  recent: { tab: 'recent' },
  goals: { tab: 'projects', goals: true }
} as const satisfies Record<string, StartPage>;

// The whole window, shot on these pages, for --window-demo.
const WHOLES = { 'cmux-workstation': 'projects', 'cmux-workstation-manager': 'manager' } as const;

// cmux redraws a sidebar about a second after it reloads.
const REDRAW = 1500;

/**
 * The steps that ready `window` for the shots: a fixed size, so every run's images match, and the preview on its right.
 */
export const setupSteps = (window: string, sidebar: string): Step[] => [
  { args: ['resize-window', '--window', window, '--width', '1400', '--height', '900'] },
  { args: ['right-sidebar', 'set', 'custom', sidebar, '--window', window] }
];

/**
 * Reloads the preview, which validates it first, so a broken bundle stops the run instead of reaching a screenshot,
 * then shoots `window` once it has redrawn.
 */
export const shotSteps = (window: string, sidebar: string, out: string): Step[] => [
  { args: ['sidebar', 'reload', sidebar] },
  { args: ['shot', '--window', window, '--out', out], wait: REDRAW }
];

if (import.meta.main) {
  const args = process.argv.slice(2);
  const demo = args.includes('--window-demo');
  const outFlag = args.indexOf('--out');
  const appearanceFlag = args.indexOf('--appearance');
  const wanted = appearanceFlag === -1 ? 'both' : args[appearanceFlag + 1];
  const appearances = APPEARANCES.filter((appearance) => wanted === 'both' || wanted === appearance);
  if (!appearances.length) {
    throw new Error('--appearance takes dark, light or both');
  }
  const out = outFlag === -1 ? mkdtempSync(join(tmpdir(), 'agentlayer-shots-')) : resolve(args[outFlag + 1] ?? '.');
  mkdirSync(out, { recursive: true });
  const name = `${SIDEBAR_NAME}-preview`;
  const preview = sidebarFile(sidebarsDir(), name);
  const own = defaultTarget().own();
  const show = (page: StartPage) => writeFileAtomic(preview, previewText(own, page));
  const raw = mkdtempSync(join(tmpdir(), 'agentlayer-shot-'));
  // Short folder names, since the demo's left sidebar shows each workspace's folder.
  const homes = demo ? mkdtempSync(join('/tmp', 'agentlayer-demo-')) : '';
  const written: string[] = [];
  show(PAGES.manager);
  try {
    await inNewWindow('AgentLayer preview', async (window) => {
      // Sized first: a terminal resized after the demo draws its conversation reflows and scrolls it.
      await runSteps(setupSteps(window, name));
      if (demo) {
        await buildDemo(window, homes);
      }
      await keepingAppearance(async (setAppearance) => {
        for (const appearance of appearances) {
          await setAppearance(appearance);
          const suffix = appearance === 'dark' ? '' : `-${appearance}`;
          for (const [page, start] of Object.entries(PAGES)) {
            const full = join(raw, `${page}${suffix}.png`);
            show(start);
            await runSteps(shotSteps(window, name, full));
            const panel = join(out, `cmux-sidebar-${page}${suffix}.png`);
            writePanel(full, panel);
            written.push(panel);
          }
          if (demo) {
            Object.entries(WHOLES).forEach(([name, page]) => {
              const whole = join(out, `${name}${suffix}.png`);
              copyFileSync(join(raw, `${page}${suffix}.png`), whole);
              written.push(whole);
            });
          }
        }
      });
    });
  } finally {
    if (homes) {
      rmSync(homes, { recursive: true, force: true });
    }
  }
  console.log(['Wrote:', ...written].join('\n  '));
}
