import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';
import { homeOfSession } from '@/shared/settings-env';

const SCRATCH = realpathSync(mkdtempSync(join(tmpdir(), 'settings-env-')));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));
const HOME = join(SCRATCH, 'Nova');
mkdirSync(join(HOME, RUNTIME_DIR), { recursive: true });
mkdirSync(join(HOME, 'projects', 'acme'), { recursive: true });
mkdirSync(join(SCRATCH, 'elsewhere'));
writeFileSync(join(HOME, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
symlinkSync(join(HOME, 'projects', 'acme'), join(SCRATCH, 'acme-link'));

test("a session's home is found from its workspace, however the folder is spelled, and none outside one", () => {
  expect(homeOfSession({ workspacePaths: [join(HOME, 'projects', 'acme')] })).toBe(HOME);
  expect(homeOfSession({ workspacePaths: [join(SCRATCH, 'acme-link')] })).toBe(HOME);
  expect(homeOfSession({ workspacePaths: [join(SCRATCH, 'elsewhere')], cwd: join(SCRATCH, 'elsewhere') })).toBe(
    undefined
  );
});
