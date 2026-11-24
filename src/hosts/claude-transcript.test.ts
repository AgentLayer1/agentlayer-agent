import { describe, expect, test } from 'bun:test';
import { backgroundByText, isBackgroundRun, withoutBackgroundRuns } from '@/hosts/claude-transcript';
import { ENTRY_SEPARATOR } from '@/knowledge/session-format';

const PLUGIN = 'agentlayer';
const LOOK =
  '<command-message>agentlayer:proposals</command-message>\n<command-name>/agentlayer:proposals</command-name>';
const REFRESH =
  '<command-message>agentlayer:sync</command-message>\n<command-name>/agentlayer:sync</command-name>\n<command-args>brain</command-args>';
const FULL_SYNC = '<command-message>agentlayer:sync</command-message>\n<command-name>/agentlayer:sync</command-name>';
const BODY = 'Base directory for this skill: /plugin/skills/proposals\n\n# Heartbeat: keep Proposals full';
const CAVEAT = '<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>';

const user = (text: string) => ({ role: 'user', text });
const reply = (text: string) => ({ role: 'assistant', text });
const kept = (turns: { role: string; text: string }[]) => {
  const flags = backgroundByText(turns, PLUGIN);
  return turns.filter((_turn, index) => !flags[index]).map((turn) => turn.text);
};

describe('background runs', () => {
  test("a look and a brain refresh are this plugin's background runs; a full sync and another plugin's look are not", () => {
    expect(isBackgroundRun(LOOK, PLUGIN)).toBe(true);
    expect(isBackgroundRun(REFRESH, PLUGIN)).toBe(true);
    expect(isBackgroundRun(FULL_SYNC, PLUGIN)).toBe(false);
    expect(isBackgroundRun(LOOK.replaceAll('agentlayer:', 'acme:'), PLUGIN)).toBe(false);
  });

  test("by text: a look, its skill body and its replies go; the operator's next turn and its reply stay", () => {
    const turns = [
      user('Fix the banner.'),
      reply('Fixed.'),
      user(LOOK),
      user(BODY),
      reply('Nothing new worth proposing.'),
      user('Thanks.'),
      reply('Welcome.')
    ];
    expect(kept(turns)).toEqual(['Fix the banner.', 'Fixed.', 'Thanks.', 'Welcome.']);
  });

  test("by text: a brain refresh goes; the operator's own full sync stays; a lone local-command note goes", () => {
    expect(kept([user(REFRESH), reply('🧠 Brain refreshed: compiled 2.')])).toEqual([]);
    expect(kept([user(FULL_SYNC), reply('Synced.')])).toEqual([FULL_SYNC, 'Synced.']);
    expect(kept([user(CAVEAT), user('Real ask.')])).toEqual(['Real ask.']);
  });

  const entry = (id: string, turns: string[]) =>
    `### Session (10:00) [${id}] · 2026-11-24 · ~/Home · turns 1–${turns.length} · claude${['', ...turns].join('\n\n')}${ENTRY_SEPARATOR}`;

  test('in a session log, an entry of only background runs is dropped and a mixed one keeps its header and work', () => {
    const log =
      '# Session Log: 2026-11-24\n\n' +
      entry('11111111-0000-4000-8000-000000000001', ['**User:** Fix the banner.', '**Assistant:** Fixed.']) +
      entry('22222222-0000-4000-8000-000000000002', [
        `**User:** ${CAVEAT}`,
        `**User:** ${LOOK}`,
        `**User:** ${BODY}`,
        '**Assistant:** Nothing new worth proposing.'
      ]) +
      entry('33333333-0000-4000-8000-000000000003', [
        `**User:** ${REFRESH}`,
        '**Assistant:** Refreshed.',
        '**User:** What changed?',
        '**Assistant:** Two articles.'
      ]);
    const kept = withoutBackgroundRuns(log, PLUGIN);
    expect(kept).toContain('Fix the banner.');
    expect(kept).not.toContain('22222222');
    expect(kept).not.toContain('Nothing new worth proposing');
    expect(kept).toContain('[33333333-0000-4000-8000-000000000003]');
    expect(kept).toContain('**User:** What changed?\n\n**Assistant:** Two articles.');
    expect(kept).not.toContain('Refreshed.');
    expect(withoutBackgroundRuns(kept, PLUGIN), 'filtering twice changes nothing').toBe(kept);
  });

  test("another host's entry is left as it is, even one quoting this plugin's command", () => {
    const codex = entry('44444444-0000-4000-8000-000000000004', [
      `**User:** ${LOOK}`,
      '**Assistant:** Explained the look.'
    ]).replace('· claude', '· codex: gpt');
    expect(withoutBackgroundRuns(codex, PLUGIN)).toBe(codex);
  });
});
