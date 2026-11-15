import { FILES, FOLDERS, TIMEZONE } from '@/config';
import { fitContext, pinnedReports, subscriptionIssue, tailOf, todaysReports } from '@/hooks/context';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe("today's reports in the session context", () => {
  test('a section over the cap is cut at the last whole entry', async () => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
    const entry = (index: number) => `- 09:0${index} · [Report ${index}](plans/report-${index}.md) · \`plan-spec\``;
    mkdirSync(FOLDERS.REPORTS, { recursive: true });
    writeFileSync(FILES.REPORTS_INDEX, `# Reports\n\n## ${today}\n\n${[1, 2, 3].map(entry).join('\n')}\n`);

    const { content } = await todaysReports(entry(1).length + entry(2).length / 2);
    expect(content).toBe(`${entry(1)}\n…(see reports/index.md)`);
    rmSync(FILES.REPORTS_INDEX, { force: true });
  });

  test('a first entry longer than the cap is left out whole, not cut mid-link', async () => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
    mkdirSync(FOLDERS.REPORTS, { recursive: true });
    writeFileSync(FILES.REPORTS_INDEX, `# Reports\n\n## ${today}\n\n- 09:00 · [A long one](plans/a-long-one.md)\n`);

    expect((await todaysReports(10)).content).toBe('…(see reports/index.md)');
    rmSync(FILES.REPORTS_INDEX, { force: true });
  });
});

describe('pinned reports in the session context', () => {
  test('lists the pins whose file is there, HOME-relative, and reads off with none pinned', () => {
    expect(pinnedReports(10)).toEqual({
      content: null,
      entry: { label: 'pinned reports', status: 'off', bytes: 0, note: 'none pinned' }
    });

    const plans = join(FOLDERS.REPORTS, 'plans');
    mkdirSync(plans, { recursive: true });
    const plan = join(plans, 'auth.md');
    writeFileSync(plan, 'x');
    const pins = join(FOLDERS.REPORTS, 'pinned.md');
    writeFileSync(pins, '# Pinned\n\n- 🛡️ [Auth plan](plans/auth.md)\n- [Gone](plans/gone.html)\n');

    const { content, entry } = pinnedReports(10);
    expect(content).toContain('- 🛡️ Auth plan — reports/plans/auth.md');
    expect(content).not.toContain('Gone');
    expect(entry).toMatchObject({ status: 'loaded', note: '1 pin' });
    expect(pinnedReports(0).content).toEndWith('\n…1 more in reports/pinned.md');
    [plan, pins].forEach((path) => rmSync(path, { force: true }));
  });
});

describe('the Claude subscription guard', () => {
  test('a home with its own subscription warns when the session started without it', () => {
    expect(subscriptionIssue(true, undefined)).toContain('then run "agent"');
  });

  test('a session started with the subscription file, or a home without one, stays quiet', () => {
    expect(subscriptionIssue(true, '1')).toBeNull();
    expect(subscriptionIssue(false, undefined)).toBeNull();
  });
});

describe('the session context under its size cap', () => {
  test('a cut inside a code fence closes the fence, with as many backticks as opened it', () => {
    const fitted = fitContext(['## Today', '## Git\n\n````\n' + 'commit line\n'.repeat(50) + '````'], 120);
    expect(fitted.endsWith('\n````\n\n...(truncated)')).toBe(true);
    expect(fitContext(['short'], 120)).toBe('short');
  });

  test("a long session tail keeps its header and the session's newest turns", () => {
    const turns = Array.from({ length: 60 }, (_unused, i) => `**User:** question ${i}\n\n**Assistant:** answer ${i}\n`).join('\n');
    const tail = tailOf(`### Session (14:15) [abc] · turns 1–120\n\n${turns}`, 600);
    expect(tail.startsWith('### Session (14:15) [abc] · turns 1–120')).toBe(true);
    expect(tail).toContain('answer 59');
    expect(tail).not.toContain('question 0\n');
    expect(tail.split('\n…\n\n')[1]?.startsWith('**')).toBe(true);
  });
});
