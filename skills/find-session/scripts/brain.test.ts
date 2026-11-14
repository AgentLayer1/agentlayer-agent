import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchBrain } from './brain';

const root = mkdtempSync(join(tmpdir(), 'find-session-brain-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const SEPARATOR = '\n\n---\n\n';
const sessions = join(root, 'knowledge', 'raw', 'sessions');
mkdirSync(sessions, { recursive: true });
writeFileSync(
  join(sessions, '2026-11-10.md'),
  '# Session Log: 2026-11-10\n\n' +
    [
      '### Session (09:00) [aaaa1111-0000-4000-8000-000000000001] · 2026-11-10 · ~/Agents/Kevin · turns 1–2 · claude\n\n**User:** fix the radar badge overflow\n\n**Assistant:** Looking at the radar.',
      '### Session (10:00) [bbbb2222-0000-4000-8000-000000000002] · 2026-11-10 · ~/Agents/Kevin · turns 1–1 · claude\n\n**User:** <command-name>/briefing</command-name>\n\n**User:** morning brief\n\n**Assistant:** Today: badge overflow is still open.\n\n```\n### Session (08:00) [cccc3333-0000-4000-8000-000000000003] · quoted\n```'
    ].join(SEPARATOR) +
    SEPARATOR
);
writeFileSync(
  join(sessions, '2026-11-11.md'),
  '# Session Log: 2026-11-11\n\n' +
    '### Pre-Compact (11:00) [aaaa1111-0000-4000-8000-000000000001] · 2026-11-11 · ~/Agents/Kevin · turns 3–4 · claude\n\n**User:** now the badge overflow on iPad\n\n**Assistant:** Fixed.' +
    SEPARATOR +
    '### Session (12:00) [dddd4444] · ~/Agents/Kevin\n\n**User:** an old capture about badge overflow\n'
);
writeFileSync(join(sessions, 'index.json'), '{}');

describe('searchBrain', () => {
  const matches = searchBrain(sessions, ['badge overflow'], null);

  test('groups a session across days and kinds of entry, and ranks the work above the mention', () => {
    expect(matches.map((match) => match.session_id)).toEqual([
      'aaaa1111-0000-4000-8000-000000000001',
      'dddd4444',
      'bbbb2222-0000-4000-8000-000000000002'
    ]);
    const [work] = matches;
    expect([work.first_date, work.last_date, work.total_hits]).toEqual(['2026-11-10', '2026-11-11', 2]);
    expect(work.blocks.map((block) => [block.date, block.turns])).toEqual([
      ['2026-11-10', '1–2'],
      ['2026-11-11', '3–4']
    ]);
    expect(work.terms_in_user_prompts).toEqual(['badge overflow']);
    expect(work.first_user_msg).toBe('fix the radar badge overflow');
  });

  test("a mention only in the agent's reply is not counted as the operator asking, and its skill run is named", () => {
    const mention = matches.find((match) => match.session_id.startsWith('bbbb'));
    expect(mention?.terms_in_user_prompts).toEqual([]);
    expect(mention?.slash_commands).toEqual(['/briefing']);
    expect(mention?.first_user_msg).toBe('morning brief');
  });

  test('a heading quoted inside an entry is not a session of its own', () => {
    expect(matches.some((match) => match.session_id.startsWith('cccc'))).toBe(false);
  });

  test("each block's line range reads back exactly that entry", () => {
    const [first, second] = matches[0].blocks;
    const lines = (block: typeof first) =>
      readFileSync(block.file, 'utf-8').split('\n').slice(block.start_line - 1, block.end_line);
    expect(lines(first)[0]).toStartWith('### Session (09:00) [aaaa1111');
    expect(lines(first).at(-1)).toBe('**Assistant:** Looking at the radar.');
    expect(lines(second)[0]).toStartWith('### Pre-Compact (11:00) [aaaa1111');
    expect(lines(second).at(-1)).toBe('**Assistant:** Fixed.');
  });

  test('days before `since` are skipped, and a missing folder finds nothing', () => {
    expect(searchBrain(sessions, ['badge overflow'], '2026-11-11').map((match) => match.session_id)).toEqual([
      'aaaa1111-0000-4000-8000-000000000001',
      'dddd4444'
    ]);
    expect(searchBrain(join(root, 'nowhere'), ['badge overflow'], null)).toEqual([]);
  });
});
