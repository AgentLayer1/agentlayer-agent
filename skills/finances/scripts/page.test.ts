import { afterAll, describe, expect, test } from 'bun:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readJsonBlock } from '../../../src/shared/json-block';
import { THEME_BLOCK } from '../../../src/shared/theme';
import { importStatement } from './import';
import { renderFinances } from './page';
import { applyEdits, parseEdits } from './rules';

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
    '---\nname: Acme Sdn. Bhd.\nkind: company\nclose: monthly\ncurrency: MYR\n---\n\n## Accounts\n\n```yaml\n- { id: acme-main, name: Acme current }\n```\n'
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

describe('the page in a browser', () => {
  const PROSE = '# Finances rules\n\n## How I categorise\n\n- Streamco is a subscription.\n';
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'finances-page-dom-'));
    dirs.push(dir);
    const write = (file: string, body: string): string => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), body);
      return join(dir, file);
    };
    write(
      'entities/ada.md',
      '---\nname: Personal\nkind: individual\nclose: none\ncurrency: MYR\n---\n\n## Accounts\n\n```yaml\n- { id: ada-main, name: Ada current }\n- { id: ada-old, name: Ada old savings }\n```\n'
    );
    write(
      'RULES.md',
      `${PROSE}\n## Learned\n\n### Payees\n\n\`\`\`yaml\n[]\n\`\`\`\n\n### Categories\n\n\`\`\`yaml\n- { payee: "STREAMCO KL", category: "entertainment" }\n\`\`\`\n`
    );
    importStatement({
      dir,
      account: 'ada-main',
      file: write(
        'data/inbox/s.csv',
        'date,description,amount,balance\n2026-09-05,STREAMCO*884412 KL,-45,955\n2026-10-05,STREAMCO*884413 KL,-45,910\n2026-10-14,RESTO X,-80,830\n2026-10-20,RESTO X,-60,770\n2026-10-31,SALARY,1000,1770\n'
      )
    });
    importStatement({
      dir,
      account: 'ada-old',
      file: write('data/inbox/o.csv', 'date,description,amount,balance\n2026-10-01,CLOSING,-5,0\n')
    });
    return dir;
  };
  const open = (html: string, hash: string) => {
    const errors: string[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error.message));
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: `https://pages.test/dashboard.html${hash}`,
      virtualConsole,
      beforeParse: (window) => {
        window.matchMedia = (query: string) =>
          ({ matches: false, media: query, addEventListener: () => undefined }) as unknown as MediaQueryList;
        window.scrollTo = () => undefined;
      }
    });
    const doc = dom.window.document;
    const click = (selector: string): void => {
      const el = doc.querySelector(selector);
      if (el === null) {
        throw new Error(`no ${selector}`);
      }
      el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    };
    return { dom, doc, click, errors };
  };

  test('where your money goes renders for a week, a month and a year without errors', () => {
    const { doc, click, errors } = open(renderFinances(setup(), '2026-11-02'), '#overview');
    expect(doc.querySelector('h1.answer')?.textContent).toContain('went out in October 2026');
    click('button[data-mode="week"]');
    click('button[data-act="step"][data-by="-1"]');
    click('button[data-mode="year"]');
    expect(doc.querySelector('h1.answer')?.textContent).toContain('2026');
    click('.cat-row');
    expect(doc.querySelector('.crumbs')?.textContent).toContain('All categories');
    expect(errors).toEqual([]);
  });

  test('accounts at zero are hidden until asked for', () => {
    const { doc, click } = open(renderFinances(setup(), '2026-11-02'), '#accounts');
    expect(doc.querySelector('#accounts')?.textContent).not.toContain('Ada old savings');
    expect(doc.querySelector('.zero-note')?.textContent).toContain('Hiding 1 account at zero');
    click('button[data-act="zero"]');
    expect(doc.querySelector('#accounts')?.textContent).toContain('Ada old savings');
  });

  test('an approval and a fix made on the page, copied and applied, come back approved after the rebuild', async () => {
    const dir = setup();
    const { dom, doc, click, errors } = open(renderFinances(dir, '2026-11-02'), '#categorise');
    click('button[data-tab="suggested"]');
    click('button[data-act="approve"]');
    click('button[data-tab="none"]');
    const row = [...doc.querySelectorAll('.work-row')].find((el) => el.textContent?.includes('RESTO X'));
    const input = row?.querySelector('input[data-fix="payee"]');
    if (!(input instanceof dom.window.HTMLInputElement)) {
      throw new Error('no picker for RESTO X');
    }
    input.value = 'Food';
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(doc.querySelector('.editbar .what')?.textContent).toContain('1 approval and 1 fix, covering 4 lines');
    click('button[data-act="copy"]');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pasted = doc.querySelector('.editbar pre')?.textContent ?? '';
    expect(pasted).toContain('```finances-edits');
    expect(applyEdits(dir, parseEdits(pasted), '2026-11-02')).toMatchObject({ approved: 1, set: 1, unknown: [] });
    const rebuilt = readJsonBlock(renderFinances(dir, '2026-11-02'), 'finance-data');
    const lines =
      rebuilt?.kind === 'data'
        ? (rebuilt.data as { lines: { payee: string; category: string | null; approved: boolean }[] }).lines
        : [];
    expect(
      lines.filter((line) => line.payee !== 'SALARY').map((line) => [line.payee, line.category, line.approved])
    ).toEqual([
      ['STREAMCO KL', 'entertainment', true],
      ['CLOSING', null, false],
      ['STREAMCO KL', 'entertainment', true],
      ['RESTO X', 'food', true],
      ['RESTO X', 'food', true]
    ]);
    expect(readFileSync(join(dir, 'RULES.md'), 'utf8').startsWith(PROSE)).toBe(true);
    expect(errors).toEqual([]);
  });

  const company = () => {
    const dir = setup();
    const write = (file: string, body: string): string => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), body);
      return join(dir, file);
    };
    write(
      'entities/acme.md',
      '---\nname: Acme\nkind: company\nclose: none\ncurrency: MYR\n---\n\n## Accounts\n\n```yaml\n- { id: acme-main, name: Acme current }\n```\n'
    );
    write(
      'RULES.md',
      `${PROSE}\n## Learned\n\n### Payees\n\n\`\`\`yaml\n[]\n\`\`\`\n\n### Categories\n\n\`\`\`yaml\n- { payee: "SCHOOL X", category: "education", for: "ada", confirmed: true }\n\`\`\`\n`
    );
    importStatement({
      dir,
      account: 'acme-main',
      file: write(
        'data/inbox/a.csv',
        'date,description,amount,balance\n2026-10-01,OPENING CREDIT,1000,1000\n2026-10-15,SCHOOL X,-100,900\n2026-10-25,CLOUD Y,-50,850\n'
      ),
      from: '2026-10-01',
      to: '2026-10-31',
      opening: 0,
      closing: 850
    });
    return dir;
  };

  test("changing only a line's category keeps whose expense it is, on the page and after the paste", async () => {
    const dir = company();
    const { dom, doc, click } = open(renderFinances(dir, '2026-11-02'), '#categorise');
    click('button[data-tab="approved"]');
    const row = [...doc.querySelectorAll('.work-row')].find((el) => el.textContent?.includes('SCHOOL X'));
    const input = row?.querySelector('input[data-fix="payee"]');
    if (!(input instanceof dom.window.HTMLInputElement)) {
      throw new Error('no picker for SCHOOL X');
    }
    input.value = 'Food';
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    click('button[data-act="copy"]');
    await new Promise((resolve) => setTimeout(resolve, 0));
    applyEdits(dir, parseEdits(doc.querySelector('.editbar pre')?.textContent ?? ''), '2026-11-02');
    const rebuilt = readJsonBlock(renderFinances(dir, '2026-11-02'), 'finance-data');
    const lines =
      rebuilt?.kind === 'data'
        ? (rebuilt.data as { lines: { payee: string; category: string; entity: string; paidBy: string | null }[] })
            .lines
        : [];
    expect(lines.find((line) => line.payee === 'SCHOOL X')).toMatchObject({
      category: 'food',
      entity: 'ada',
      paidBy: 'acme'
    });
  });

  test('approve all approves only the payees shown, and one undo takes the whole batch back', async () => {
    const dir = setup();
    writeFileSync(
      join(dir, 'RULES.md'),
      `${PROSE}\n## Learned\n\n### Payees\n\n\`\`\`yaml\n[]\n\`\`\`\n\n### Categories\n\n\`\`\`yaml\n- { payee: "STREAMCO KL", category: "entertainment" }\n- { payee: "RESTO X", category: "food" }\n- { payee: "SALARY", category: "income" }\n\`\`\`\n`
    );
    const { dom, doc, click, errors } = open(renderFinances(dir, '2026-11-02'), '#categorise');
    click('button[data-tab="suggested"]');
    const suggested = (): string[] =>
      [...doc.querySelectorAll('.work-row strong')].map((el) => el.textContent ?? '').toSorted();
    expect(suggested()).toEqual(['RESTO X', 'SALARY', 'STREAMCO KL']);
    expect(doc.querySelector('button[data-bulk]')?.textContent).toBe('Approve all 3 payees (5 lines)');
    const find = (text: string): void => {
      const search = doc.querySelector('input[data-search]');
      if (!(search instanceof dom.window.HTMLInputElement)) {
        throw new Error('no search box');
      }
      search.value = text;
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    };
    find('a');
    expect(doc.querySelector('button[data-bulk]')?.textContent).toBe('Approve all 2 payees (3 lines)');
    click('button[data-bulk]');
    find('');
    expect(suggested()).toEqual(['RESTO X']);
    click('button[data-act="undo"]');
    expect(suggested()).toEqual(['RESTO X', 'SALARY', 'STREAMCO KL']);
    click('button[data-bulk]');
    expect(suggested()).toEqual([]);
    click('button[data-act="copy"]');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pasted = doc.querySelector('.editbar pre')?.textContent ?? '';
    expect(applyEdits(dir, parseEdits(pasted), '2026-11-02')).toMatchObject({ approved: 3, unknown: [] });
    expect(errors).toEqual([]);
  });

  test('a period still in progress counts both sides only to the day every statement reaches', () => {
    const { doc } = open(renderFinances(company(), '2026-11-02'), '#overview');
    expect(doc.querySelector('h1.answer')?.textContent).toBe('RM\u00a05 went out in October 2026 so far.');
  });

  test('hiding amounts hides the figures in a failing check too', () => {
    const dir = company();
    const file = join(dir, 'data/inbox/b.csv');
    writeFileSync(file, 'date,description,amount,balance\n2026-11-01,CLOUD Y,-50,1184.56\n');
    importStatement({
      dir,
      account: 'acme-main',
      file,
      from: '2026-11-01',
      to: '2026-11-01',
      opening: 1234.56,
      closing: 1184.56
    });
    const { doc, click } = open(renderFinances(dir, '2026-11-02'), '#health');
    click('#mask');
    const note = [...doc.querySelectorAll('#health .note')].find((el) => el.textContent?.includes('1234.56'));
    expect(note?.closest('.amt')).not.toBeNull();
    expect(doc.body.classList.contains('masked')).toBe(true);
  });

  test("summaries switch to USD at each month's rate, a month with no rate is left out and said so, and lines keep their own currency", () => {
    const dir = company();
    writeFileSync(join(dir, 'data/rates.csv'), 'month,currency,per_usd\n2026-10,MYR,5\n');
    const { doc, click } = open(renderFinances(dir, '2026-11-02'), '#overview');
    expect(doc.querySelector('#currency')?.textContent).toBe('MYRUSD');
    click('button[data-usd="true"]');
    expect(doc.querySelector('h1.answer')?.textContent).toBe('$1 went out in October 2026 so far.');
    const flows = open(renderFinances(dir, '2026-11-02'), '#cashflow');
    flows.click('button[data-usd="true"]');
    expect(flows.doc.querySelector('#cashflow .lede')?.textContent).toMatch(
      /In USD, other currencies converted at each month's central-bank rate; \d+ lines? with no rate/
    );
    const lines = open(renderFinances(dir, '2026-11-02'), '#categorise');
    lines.click('button[data-usd="true"]');
    lines.click('button[data-tab="approved"]');
    lines.click('button[data-act="open"]');
    const amounts = [...lines.doc.querySelectorAll('.work-lines td.num')].map((cell) => cell.textContent ?? '');
    expect(amounts.length).toBeGreaterThan(0);
    expect(amounts.every((text) => text.includes('RM'))).toBe(true);
  });

  test('the personal entity comes first, then the companies by name', () => {
    const dir = company();
    mkdirSync(join(dir, 'entities'), { recursive: true });
    writeFileSync(join(dir, 'entities/aaa.md'), '---\nname: Zed Ltd\nkind: company\nclose: none\ncurrency: MYR\n---\n');
    const { doc } = open(renderFinances(dir, '2026-11-02'), '#overview');
    expect([...doc.querySelectorAll('#entities button')].map((button) => button.textContent)).toEqual([
      'All',
      'Personal',
      'Acme',
      'Zed Ltd'
    ]);
  });

  test('the page opens on where the money goes, and links to the old page names still land', () => {
    const first = open(renderFinances(setup(), '2026-11-02'), '');
    expect(first.doc.querySelector('section.page.on')?.id).toBe('overview');
    expect(first.doc.querySelector('#overview h1.answer')?.textContent).toContain('went out in October 2026');
    const spending = open(renderFinances(setup(), '2026-11-02'), '#spending');
    expect(spending.doc.querySelector('section.page.on')?.id).toBe('overview');
    expect(spending.dom.window.location.hash).toBe('#overview');
    const checks = open(renderFinances(setup(), '2026-11-02'), '#checks');
    expect(checks.doc.querySelector('section.page.on')?.id).toBe('health');
    expect(checks.doc.querySelector('#health .kicker')?.textContent).toBe('Health');
  });

  test('the tax page is framed without its own chrome, and follows the entity switch and the theme', () => {
    const { dom, doc, click, errors } = open(renderFinances(company(), '2026-11-02'), '#tax');
    const frame = doc.querySelector('iframe.tax');
    if (!(frame instanceof dom.window.HTMLIFrameElement)) {
      throw new Error('no tax frame');
    }
    const inner = frame.contentDocument;
    if (inner === null) {
      throw new Error('no frame document');
    }
    inner.documentElement.innerHTML =
      /<html[^>]*>([\s\S]*)<\/html>/.exec(frame.getAttribute('srcdoc') ?? '')?.[1] ?? '';
    frame.dispatchEvent(new dom.window.Event('load'));
    expect(inner.querySelector('header, nav.tabs')).toBeNull();
    expect(inner.querySelector('#theme-slot')?.hasAttribute('hidden')).toBe(true);
    const checked = (): string | undefined => inner.querySelector('input.tab:checked')?.id;
    expect(checked()).toBe('tab-overview');
    click('button[data-entity="acme"]');
    expect(checked()).toBe('tab-acme');
    doc.documentElement.setAttribute('data-theme', 'dark');
    doc.dispatchEvent(new dom.window.CustomEvent('themechange'));
    expect(inner.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(errors).toEqual([]);
  });

  test('nothing owed shows as zero, never a negative zero', () => {
    const { doc } = open(renderFinances(setup(), '2026-11-02'), '#accounts');
    const owed = [...doc.querySelectorAll('.tile')].find((tile) => tile.textContent?.includes('Cards owed'));
    expect(owed?.querySelector('.value')?.textContent).toBe('RM\u00a00');
  });

  test('the currency switch is hidden when the local currency is already USD', () => {
    const dir = setup();
    writeFileSync(
      join(dir, 'entities/ada.md'),
      '---\nname: Personal\nkind: individual\nclose: none\ncurrency: USD\n---\n\n## Accounts\n\n```yaml\n- { id: ada-main, name: Ada current }\n- { id: ada-old, name: Ada old savings }\n```\n'
    );
    const { doc } = open(renderFinances(dir, '2026-11-02'), '#overview');
    expect(doc.querySelector<HTMLElement>('#currency')?.hidden).toBe(true);
  });
});
