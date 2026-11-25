import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workRootsOf } from '@/home/work-roots';

const SCRATCH = realpathSync(mkdtempSync(join(tmpdir(), 'work-roots-')));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));
const HOME = join(SCRATCH, 'Nova');
const CODE = join(SCRATCH, 'acme-code');
[join(HOME, 'notes'), CODE].forEach((folder) => mkdirSync(folder, { recursive: true }));
symlinkSync(CODE, join(HOME, 'code-link'), 'junction');

test('a configured folder counts by where it leads: a link in the home to code outside it is a root, the home itself is not', () => {
  const roots = (dirs: string[]) => workRootsOf(HOME, { permissions: { additionalDirectories: dirs } });
  expect(roots([join(HOME, 'code-link')])).toEqual([join(HOME, 'code-link')]);
  expect(roots(['code-link'])).toEqual([join(HOME, 'code-link')]);
  expect(roots([join(HOME, 'notes'), HOME])).toEqual([]);
});
