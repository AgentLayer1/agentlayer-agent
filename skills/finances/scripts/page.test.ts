import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readJsonBlock } from '../../../src/shared/json-block';
import { THEME_BLOCK } from '../../../src/shared/theme';
import { importStatement } from './import';
import { renderFinances } from './page';

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const project = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'finances-page-'));
  dirs.push(dir);
  const write = (file: string, body: string): string => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), body);
    return join(dir, file);
  };
  write(
    'entities/acme.md',
    '---\nname: Acme Sdn. Bhd.\nkind: company\nclose: monthly\n---\n\n## Accounts\n\n```yaml\n- { id: acme-main, name: Acme current }\n```\n'
  );
  importStatement({
    dir,
    account: 'acme-main',
    file: write(
      'data/inbox/s.csv',
      'date,description,amount,balance\n2026-10-01,HOSTING </script><!-- x,-50,950\n2026-10-31,CLIENT,1000,1950\n'
    )
  });
  return dir;
};

describe('renderFinances', () => {
  const dir = project();
  const html = renderFinances(dir, '2026-11-02');

  test('makes no external requests', () => {
    const own = html.replace(THEME_BLOCK, '');
    expect(own).not.toMatch(
      /<script[^>]+src=|<link[^>]+href=["']https?:|src=["']https?:|url\(\s*["']?https?:|@import/i
    );
  });

  test('carries its data in a block any feature can read without running the page, even when a description holds markup', () => {
    const block = readJsonBlock(html, 'finance-data');
    expect(block?.kind).toBe('data');
    const data =
      block?.kind === 'data' ? (block.data as { lines: { payee: string }[]; accounts: { balance: number }[] }) : null;
    expect(data?.accounts[0]?.balance).toBe(1950);
    expect(data?.lines[0]?.payee).toContain('<!--');
    expect(html.split('</script>').length).toBe(html.split('<script').length);
  });

  test('frames the tax page on its tab, escaped into one attribute', () => {
    const frame = /<iframe class="tax" title="Tax" srcdoc="([^"]*)"><\/iframe>/.exec(html);
    expect(frame?.[1]).toContain('Acme Sdn. Bhd.');
    expect(html.match(/<\/iframe>/g)).toHaveLength(1);
    expect(frame?.[1]).toContain('&quot;');
  });

  test('fills every slot and is the same for the same inputs', () => {
    expect(html).not.toMatch(/\{\{[A-Z]+\}\}/);
    expect(renderFinances(dir, '2026-11-02')).toBe(html);
  });

  test('a project with no profiles yet says how to start', () => {
    const empty = mkdtempSync(join(tmpdir(), 'finances-page-'));
    dirs.push(empty);
    expect(renderFinances(empty, '2026-11-02')).toContain('No entity profiles yet');
  });
});
