import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENTRY = join(ROOT, 'src', 'cmux', 'sidebar', 'main.ts');
export const DIST = join(ROOT, 'src', 'cmux', 'sidebar', 'dist', 'sidebar.js');

/**
 * Bundles the sidebar into the one script cmux loads, headed by the entry's leading comment.
 */
export const bundleSidebar = async (): Promise<string> => {
  const header = readFileSync(ENTRY, 'utf8').match(/^\/\*[\s\S]*?\*\//)?.[0];
  if (!header) {
    throw new Error(`${ENTRY} must open with a /* … */ header comment`);
  }
  const { outputs } = await Bun.build({
    entrypoints: [ENTRY],
    root: ROOT,
    format: 'esm',
    target: 'browser',
    banner: header
  });
  const [output] = outputs;
  if (!output) {
    throw new Error(`bundling ${ENTRY} produced no output`);
  }
  return output.text();
};

if (import.meta.main) {
  writeFileSync(DIST, await bundleSidebar());
  console.log(`Wrote ${DIST}`);
}
