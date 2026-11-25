import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestLoads, sandboxOnIn, sandboxProblem, splitPieces } from '@/hosts/antigravity';

describe('splitPieces', () => {
  const bytes = (text: string): number => Buffer.byteLength(text);

  test('cuts at line breaks, keeps every piece under the cap, and joins back to the text', () => {
    const text = Array.from({ length: 50 }, (_unused, index) => `line ${index} ${'x'.repeat(30)}`).join('\n');
    const pieces = splitPieces(text, 200);
    expect(pieces.length).toBeGreaterThan(5);
    expect(pieces.every((piece) => bytes(piece) <= 200)).toBe(true);
    expect(pieces.slice(0, -1).every((piece) => piece.endsWith('\n'))).toBe(true);
    expect(pieces.join('')).toBe(text);
  });

  test('cuts a line longer than the cap between characters, never inside one', () => {
    const line = 'é🐙'.repeat(40);
    const pieces = splitPieces(line, 15);
    expect(pieces.every((piece) => bytes(piece) <= 15 && !piece.includes('�'))).toBe(true);
    expect(pieces.join('')).toBe(line);
  });

  test('empty text gives no pieces', () => {
    expect(splitPieces('')).toEqual([]);
  });
});

describe('manifestLoads', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'antigravity-manifest-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const checkout = join(scratch, 'acme-plugin');
  mkdirSync(checkout);
  symlinkSync(checkout, join(scratch, 'linked-plugin'), 'junction');
  const manifest = (name: string, text: string): string => {
    const path = join(scratch, name);
    writeFileSync(path, text);
    return path;
  };

  test('is true when an entry names the checkout, however the path is spelled', () => {
    expect(manifestLoads(manifest('direct.json', JSON.stringify({ entries: [{ path: checkout }] })), checkout)).toBe(
      true
    );
    const linked = manifest('linked.json', JSON.stringify({ entries: [{ path: join(scratch, 'linked-plugin') }] }));
    expect(manifestLoads(linked, checkout)).toBe(true);
  });

  test('is false for another checkout, a missing file, or one that does not parse', () => {
    expect(manifestLoads(manifest('other.json', JSON.stringify({ entries: [{ path: scratch }] })), checkout)).toBe(
      false
    );
    expect(manifestLoads(join(scratch, 'absent.json'), checkout)).toBe(false);
    expect(manifestLoads(manifest('broken.json', '{'), checkout)).toBe(false);
  });
});

describe('sandboxOnIn', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'antigravity-sandbox-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const settings = (name: string, text: string): string => {
    const path = join(scratch, name);
    writeFileSync(path, text);
    return path;
  };

  test('is on only when the settings say true', () => {
    expect(sandboxOnIn(settings('on.json', JSON.stringify({ enableTerminalSandbox: true })))).toBe(true);
    expect(sandboxOnIn(settings('off.json', JSON.stringify({ enableTerminalSandbox: false })))).toBe(false);
    expect(sandboxOnIn(settings('unset.json', JSON.stringify({ trustedWorkspaces: [] })))).toBe(false);
    expect(sandboxOnIn(join(scratch, 'absent.json'))).toBe(false);
    expect(sandboxOnIn(settings('broken.json', '{'))).toBe(false);
  });

  test('on Windows, a build older than the sandbox needs is a problem even with the setting on', () => {
    const on = settings('on-win.json', JSON.stringify({ enableTerminalSandbox: true }));
    expect(sandboxProblem(on, 'win32', '10.0.22631')).toContain('build 22631');
    expect(sandboxProblem(on, 'win32', '10.0.26100')).toBeNull();
    expect(sandboxProblem(on, 'darwin', '25.0.0')).toBeNull();
    expect(sandboxProblem(settings('off-win.json', '{}'), 'win32', '10.0.26100')).toContain('is off in');
  });
});
