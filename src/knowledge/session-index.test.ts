import { describe, expect, test } from 'bun:test';
import { formatEntryHeader, parseEntryHeaders } from '@/knowledge/session-format';
import { adoptLegacyKey, diffTurns, fingerprintTurn, healFromDayFiles, recordCapture } from '@/knowledge/session-index';
import type { SessionIndex, SessionRecord, TranscriptTurn } from '@/knowledge/types';

const turn = (role: 'user' | 'assistant', text: string): TranscriptTurn => ({ role, text });

/** A deterministic N-turn transcript: u1, a1, u2, a2, … */
const transcript = (n: number): TranscriptTurn[] =>
  Array.from({ length: n }, (_unused, i) => turn(i % 2 === 0 ? 'user' : 'assistant', `turn ${i + 1}`));

const recordFor = (turns: TranscriptTurn[], capturedTurns: number): SessionRecord => ({
  first_seen: '2026-06-01',
  last_seen: '2026-06-01',
  cwd: '~/Kevin',
  captured_turns: capturedTurns,
  last_turn_fp: fingerprintTurn(turns[capturedTurns - 1]),
  briefing: 'stub',
  blocks: [{ date: '2026-06-01', from: 1, to: capturedTurns }]
});

describe('diffTurns', () => {
  test('new session returns every turn from 1', () => {
    const turns = transcript(8);
    const diff = diffTurns(turns, null);
    expect(diff.from).toBe(1);
    expect(diff.to).toBe(8);
    expect(diff.newTurns).toHaveLength(8);
    expect(diff.reanchored).toBe(false);
  });

  test('empty transcript yields no new turns', () => {
    const diff = diffTurns([], null);
    expect(diff.newTurns).toHaveLength(0);
  });

  test('re-capture with no growth yields nothing (kills the double-dump)', () => {
    const turns = transcript(8);
    const prior = recordFor(turns, 8);
    const diff = diffTurns(turns, prior);
    expect(diff.newTurns).toHaveLength(0);
    expect(diff.reanchored).toBe(false);
  });

  test('resume slices only the appended turns', () => {
    const turns = transcript(15);
    const prior = recordFor(turns, 8);
    const diff = diffTurns(turns, prior);
    expect(diff.from).toBe(9);
    expect(diff.to).toBe(15);
    expect(diff.newTurns).toHaveLength(7);
    expect(diff.reanchored).toBe(false);
    expect(diff.newTurns[0].text).toBe('turn 9');
  });

  test('anchor fingerprint mismatch re-emits the whole session (no content loss)', () => {
    const turns = transcript(15);
    const prior = { ...recordFor(turns, 8), last_turn_fp: 'stale-does-not-match' };
    const diff = diffTurns(turns, prior);
    expect(diff.reanchored).toBe(true);
    expect(diff.from).toBe(1);
    expect(diff.newTurns).toHaveLength(15);
  });

  test('a shrunken transcript is re-emitted whole and flagged, never sliced negative or skipped', () => {
    const turns = transcript(3);
    const prior = recordFor(transcript(8), 8);
    const diff = diffTurns(turns, prior);
    expect(diff).toMatchObject({ from: 1, to: 3, reanchored: true });
    expect(diff.newTurns).toHaveLength(3);
  });

  test('an empty transcript is never a rewrite', () => {
    expect(diffTurns([], recordFor(transcript(8), 8)).newTurns).toHaveLength(0);
  });

  test('PreCompact → SessionEnd cycle: second capture is empty', () => {
    const turns = transcript(40);
    // PreCompact at turn 40
    const first = diffTurns(turns, null);
    expect(first.newTurns).toHaveLength(40);
    const afterFirst = recordFor(turns, first.to);
    // SessionEnd at turn 40 — same transcript, no new turns
    const second = diffTurns(turns, afterFirst);
    expect(second.newTurns).toHaveLength(0);
  });
});

describe('recordCapture', () => {
  const empty: SessionIndex = { schema: 1, sessions: {} };

  test('creates a fresh record', () => {
    const next = recordCapture(empty, {
      sessionId: 'abc12345',
      date: '2026-06-01',
      cwd: '~/Kevin',
      from: 1,
      to: 8,
      lastTurnFp: 'fp8',
      briefingStub: 'designing pipeline'
    });
    const rec = next.sessions.abc12345;
    expect(rec.first_seen).toBe('2026-06-01');
    expect(rec.captured_turns).toBe(8);
    expect(rec.briefing).toBe('designing pipeline');
    expect(rec.blocks).toEqual([{ date: '2026-06-01', from: 1, to: 8 }]);
  });

  test('contiguous same-day capture coalesces blocks, preserves first_seen/briefing', () => {
    const after1 = recordCapture(empty, {
      sessionId: 'abc12345',
      date: '2026-06-01',
      cwd: '~/Kevin',
      from: 1,
      to: 40,
      lastTurnFp: 'fp40',
      briefingStub: 'original'
    });
    const after2 = recordCapture(after1, {
      sessionId: 'abc12345',
      date: '2026-06-01',
      cwd: '~/Kevin',
      from: 41,
      to: 55,
      lastTurnFp: 'fp55',
      briefingStub: 'IGNORED on extend'
    });
    const rec = after2.sessions.abc12345;
    expect(rec.captured_turns).toBe(55);
    expect(rec.briefing).toBe('original');
    expect(rec.blocks).toEqual([{ date: '2026-06-01', from: 1, to: 55 }]);
  });

  test('resume on a later day appends a separate block', () => {
    const mon = recordCapture(empty, {
      sessionId: 'abc12345',
      date: '2026-06-01',
      cwd: '~/Kevin',
      from: 1,
      to: 8,
      lastTurnFp: 'fp8',
      briefingStub: 'mon'
    });
    const wed = recordCapture(mon, {
      sessionId: 'abc12345',
      date: '2026-06-03',
      cwd: '~/Kevin',
      from: 9,
      to: 15,
      lastTurnFp: 'fp15',
      briefingStub: 'wed'
    });
    const rec = wed.sessions.abc12345;
    expect(rec.first_seen).toBe('2026-06-01');
    expect(rec.last_seen).toBe('2026-06-03');
    expect(rec.blocks).toEqual([
      { date: '2026-06-01', from: 1, to: 8 },
      { date: '2026-06-03', from: 9, to: 15 }
    ]);
  });
});

describe('adoptLegacyKey', () => {
  const record = {
    first_seen: '2026-09-01',
    last_seen: '2026-09-01',
    cwd: '~',
    captured_turns: 4,
    last_turn_fp: 'fp',
    briefing: 'b',
    blocks: []
  };

  test('folds a pre-0.4.1 short-key entry onto the full id', () => {
    const index = { schema: 1, sessions: { '01a0795e': record } };
    const adopted = adoptLegacyKey(index, '01a0795e-2ef1-7a60-b59c-0e2360c2d352');
    expect(Object.keys(adopted.sessions)).toEqual(['01a0795e-2ef1-7a60-b59c-0e2360c2d352']);
    expect(adopted.sessions['01a0795e-2ef1-7a60-b59c-0e2360c2d352']).toBe(record);
  });

  test('leaves the index alone when the full id already has an entry or nothing matches', () => {
    const both = {
      schema: 1,
      sessions: { '01a0795e': record, '01a0795e-2ef1-7a60-b59c-0e2360c2d352': { ...record, captured_turns: 9 } }
    };
    expect(adoptLegacyKey(both, '01a0795e-2ef1-7a60-b59c-0e2360c2d352')).toBe(both);
    const none = { schema: 1, sessions: { deadbeef: record } };
    expect(adoptLegacyKey(none, '01a0795e-2ef1-7a60-b59c-0e2360c2d352')).toBe(none);
  });
});

describe('header format ↔ parse round-trip', () => {
  test('fresh-session header parses back to the same fields', () => {
    const header = formatEntryHeader({
      heading: 'Session',
      time: '09:14',
      sessionId: 'abc12345',
      date: '2026-06-01',
      source: '~/Documents/Agents/Kevin',
      from: 1,
      to: 8,
      harness: 'claude'
    });
    const [parsed] = parseEntryHeaders(header);
    expect(parsed).toEqual({
      heading: 'Session',
      sessionId: 'abc12345',
      date: '2026-06-01',
      source: '~/Documents/Agents/Kevin',
      from: 1,
      to: 8
    });
  });

  test('continuation header with markers still parses the core fields', () => {
    const header = formatEntryHeader({
      heading: 'Session',
      time: '11:02',
      sessionId: 'abc12345',
      date: '2026-06-03',
      source: '~/Kevin',
      from: 9,
      to: 15,
      harness: 'claude',
      model: 'claude-opus-5, claude-fable-5',
      continues: '2026-06-01',
      reanchored: true
    });
    expect(header).toContain('· turns 9–15 · claude: claude-opus-5, claude-fable-5 · ↩ continues 2026-06-01');
    expect(header).toContain('⚠ re-anchored');
    const [parsed] = parseEntryHeaders(header);
    expect(parsed.from).toBe(9);
    expect(parsed.to).toBe(15);
    expect(parsed.sessionId).toBe('abc12345');
  });

  test('preserves the load-bearing `### Session (HH:MM) ` prefix', () => {
    const header = formatEntryHeader({
      heading: 'Session',
      time: '09:14',
      sessionId: 'abc12345',
      date: '2026-06-01',
      source: '~/Kevin',
      from: 1,
      to: 8,
      harness: 'claude'
    });
    expect(header.startsWith('### Session (09:14) ')).toBe(true);
  });

  test('a full UUID session id round-trips', () => {
    const header = formatEntryHeader({
      heading: 'Session',
      time: '08:57',
      sessionId: '01a0795e-2ef1-7a60-b59c-0e2360c2d352',
      date: '2026-09-07',
      source: '~/Test',
      from: 1,
      to: 3,
      harness: 'codex',
      model: 'gpt-6-astra'
    });
    const [parsed] = parseEntryHeaders(header);
    expect(parsed.sessionId).toBe('01a0795e-2ef1-7a60-b59c-0e2360c2d352');
    expect(parsed.to).toBe(3);
  });

  test('legacy headers without a turn range are skipped', () => {
    const legacy = '### Session (09:14) [abc12345] · ~/Kevin';
    expect(parseEntryHeaders(legacy)).toHaveLength(0);
  });
});

describe('healFromDayFiles', () => {
  const sessionId = '0d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6';
  const header = (from: number, to: number, id = sessionId) => ({
    heading: 'Session',
    sessionId: id,
    date: '2026-06-02',
    source: '~/Kevin',
    from,
    to
  });
  const indexAt = (turns: TranscriptTurn[], captured: number): SessionIndex => ({
    schema: 1,
    sessions: { [sessionId]: recordFor(turns, captured) }
  });

  test('moves a cursor the day file is ahead of, so the written turns are not offered again', () => {
    const turns = transcript(3);
    const healed = healFromDayFiles(indexAt(turns, 2), sessionId, turns, [header(1, 2), header(3, 3)], 'stub');
    expect(healed.sessions[sessionId]).toMatchObject({ captured_turns: 3, last_turn_fp: fingerprintTurn(turns[2]) });
    expect(diffTurns(turns, healed.sessions[sessionId] ?? null).newTurns).toHaveLength(0);
  });

  test('creates the record when the first capture wrote its block and never saved the index', () => {
    const turns = transcript(2);
    const healed = healFromDayFiles({ schema: 1, sessions: {} }, sessionId, turns, [header(1, 2)], 'stub');
    expect(healed.sessions[sessionId]).toMatchObject({ captured_turns: 2, briefing: 'stub', first_seen: '2026-06-02' });
  });

  test('leaves the index alone when it already covers the day file, or the blocks are another session', () => {
    const turns = transcript(3);
    const current = indexAt(turns, 3);
    expect(healFromDayFiles(current, sessionId, turns, [header(1, 3)], 'stub')).toBe(current);
    const behind = indexAt(turns, 2);
    expect(
      healFromDayFiles(behind, sessionId, turns, [header(3, 3, 'ffffffff-0000-4000-8000-000000000000')], 'stub')
    ).toBe(behind);
  });

  test('ignores a block past the end of the transcript, which a rewritten transcript cannot vouch for', () => {
    const turns = transcript(2);
    const behind = indexAt(turns, 1);
    expect(healFromDayFiles(behind, sessionId, turns, [header(2, 5)], 'stub')).toBe(behind);
  });

  test('trusts only the newest block, so an older, longer one from before a re-anchor never skips new turns', () => {
    const regrown = transcript(5);
    const afterReanchor = indexAt(regrown, 2);
    expect(healFromDayFiles(afterReanchor, sessionId, regrown, [header(1, 5), header(1, 2)], 'stub')).toBe(
      afterReanchor
    );
    const longer = transcript(45);
    const caughtUp = indexAt(longer, 32);
    expect(
      healFromDayFiles(caughtUp, sessionId, longer, [header(1, 40), header(1, 30), header(31, 32)], 'stub')
    ).toBe(caughtUp);
  });
});
