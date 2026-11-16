/**
 * `bun run cmux:preview [path]` writes the sidebar drawing the invented homes, for a screenshot in cmux;
 * `bun run cmux:preview --text` prints what each page draws instead, from cmux's own runtime.
 */
import { writeFileAtomic } from '@/shared/utils';
import { SIDEBAR_NAME, sidebarFile, sidebarsDir } from '../file';
import { defaultTarget } from '../lifecycle';
import { hasRuntime, mount, RUNTIME } from '../runtime-harness';
import { previewText } from './preview';

const args = process.argv.slice(2);
const own = defaultTarget().own();

if (args.includes('--text')) {
  if (!hasRuntime) {
    console.error(`cmux's sidebar runtime isn't at ${RUNTIME}: install cmux to preview the sidebar.`);
    process.exit(1);
  }
  console.log(mount(previewText(own)).visibleTexts().join('\n'));
} else {
  const out = args[0] ?? sidebarFile(sidebarsDir(), `${SIDEBAR_NAME}-preview`);
  writeFileAtomic(out, previewText(own));
  console.log(`Wrote ${out}. From a cmux terminal: cmux right-sidebar set custom ${SIDEBAR_NAME}-preview`);
}
