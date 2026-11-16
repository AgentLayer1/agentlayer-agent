/**
 * `bun run cmux:preview [path]` writes the sidebar drawing the invented homes, for a screenshot in cmux;
 * `bun run cmux:preview --text` prints what each page draws instead, from cmux's own runtime.
 */
import { readFileSync } from 'node:fs';
import { pluginVersion } from '@/shared/naming';
import { DIST } from '../build';
import { SIDEBAR_NAME, sidebarFile, sidebarsDir } from '../file';
import { previewSidebar, previewText } from '../lifecycle';
import { hasRuntime, mount, RUNTIME } from '../runtime-harness';

const PAGES = ['Home', 'Agents', 'Ask'];
const args = process.argv.slice(2);
const own = { version: pluginVersion(), bundle: readFileSync(DIST, 'utf8') };

if (args.includes('--text')) {
  if (!hasRuntime) {
    console.error(`cmux's sidebar runtime isn't at ${RUNTIME}: install cmux to preview the sidebar.`);
    process.exit(1);
  }
  const sidebar = mount(previewText(own));
  PAGES.forEach((page) => {
    sidebar.tap(page);
    console.log(`── ${page}\n${sidebar.visibleTexts().join('\n')}\n`);
  });
} else {
  const out = args[0] ?? sidebarFile(sidebarsDir(), `${SIDEBAR_NAME}-preview`);
  previewSidebar(out, own);
  console.log(`Wrote ${out}. From a cmux terminal: cmux right-sidebar set custom ${SIDEBAR_NAME}-preview`);
}
