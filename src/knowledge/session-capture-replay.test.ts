import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import type { CaptureMode } from '@/knowledge/session-capture';
import type { PendingCapture, SessionIndex } from '@/knowledge/types';
import { todayDate } from '@/shared/date';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';

/**
 * A capture saves its block as pending, appends it, then saves the index. One that stops between any two steps must
 * leave the next capture of that session writing each turn exactly once.
 */
const HOME = mkdtempSync(resolve(tmpdir(), 'capture-replay-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

const SESSIONS = resolve(HOME, 'knowledge', 'raw', 'sessions');
const INDEX = resolve(SESSIONS, 'index.json');
const transcriptPath = resolve(HOME, 'transcript.jsonl');

let captureSession: typeof import('@/knowledge/session-capture').captureSession;

const writeTranscript = (texts: string[]): void => {
  const lines = texts.map((text, index) =>
    JSON.stringify({ message: { role: index % 2 === 0 ? 'user' : 'assistant', content: text } })
  );
  writeFileSync(transcriptPath, lines.join('\n'), 'utf-8');
};
const messages = (count: number, tag = 'replay'): string[] =>
  Array.from({ length: count }, (_unused, index) => `${tag} message ${index + 1}`);

const capture = (sessionId: string, mode: CaptureMode = 'session-end') =>
  captureSession({ transcriptPath, cwd: HOME, sessionId, mode });
const readIndex = (): SessionIndex => JSON.parse(readFileSync(INDEX, 'utf-8')) as SessionIndex;
const dayFile = (): string => resolve(SESSIONS, `${todayDate()}.md`);
const sizeOf = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};
const occurrences = (text: string): number => readFileSync(dayFile(), 'utf-8').split(text).length - 1;

/** The index a capture leaves when it stops after its append and before its last save. */
const stoppedAfterAppend = (before: SessionIndex, sessionId: string, offset: number): SessionIndex => {
  const after = readIndex();
  const record = after.sessions[sessionId];
  const block = readFileSync(dayFile()).subarray(offset);
  const header = block.toString('utf-8').split('\n')[0] ?? '';
  const last = record?.blocks.at(-1);
  if (!record || !last) {
    throw new Error('the capture wrote no record');
  }
  const pending: PendingCapture = {
    file: `${last.date}.md`,
    offset,
    bytes: block.length,
    header,
    capture: {
      sessionId,
      date: last.date,
      cwd: record.cwd,
      from: (before.sessions[sessionId]?.captured_turns ?? 0) + 1,
      to: record.captured_turns,
      lastTurnFp: record.last_turn_fp,
      briefingStub: record.briefing
    }
  };
  return { ...before, pending };
};

beforeAll(async () => {
  mkdirSync(SESSIONS, { recursive: true });
  mkdirSync(resolve(HOME, RUNTIME_DIR), { recursive: true });
  writeFileSync(resolve(HOME, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
  ({ captureSession } = await import('@/knowledge/session-capture'));
});

afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  if (PRELOAD_HOME === undefined) delete process.env.AGENT_HOME;
  else process.env.AGENT_HOME = PRELOAD_HOME;
});

describe('a capture replayed after an interrupted write', () => {
  test('a later block that landed is recorded, not written again', async () => {
    const sessionId = '1a2b3c4d-0000-4000-8000-00000000aaaa';
    writeTranscript(messages(2));
    await capture(sessionId);
    const before = readIndex();
    const offset = sizeOf(dayFile());
    writeTranscript(messages(3));
    expect((await capture(sessionId)).saved).toBe(true);
    writeFileSync(INDEX, JSON.stringify(stoppedAfterAppend(before, sessionId, offset)));

    expect(await capture(sessionId)).toMatchObject({ saved: false, reason: 'no-new-turns' });
    expect(occurrences('replay message 3')).toBe(1);
    expect(readIndex()).toMatchObject({ sessions: { [sessionId]: { captured_turns: 3 } } });
    expect(readIndex().pending).toBeUndefined();
  });

  test('a first block that landed is recorded, not written again', async () => {
    const sessionId = '1a2b3c4d-0000-4000-8000-00000000bbbb';
    const before = readIndex();
    const offset = sizeOf(dayFile());
    writeTranscript(messages(2));
    expect((await capture(sessionId)).saved).toBe(true);
    writeFileSync(INDEX, JSON.stringify(stoppedAfterAppend(before, sessionId, offset)));

    expect(await capture(sessionId)).toMatchObject({ saved: false, reason: 'no-new-turns' });
    expect(occurrences(`[${sessionId}]`)).toBe(1);
  });

  test('a block that never landed is dropped, and its turns are written once', async () => {
    const sessionId = '1a2b3c4d-0000-4000-8000-00000000cccc';
    writeTranscript(messages(2, 'unlanded'));
    await capture(sessionId);
    const before = readIndex();
    const never: PendingCapture = {
      file: basename(dayFile()),
      offset: sizeOf(dayFile()),
      bytes: 64,
      header: `### Session (00:00) [${sessionId}] · never written`,
      capture: { sessionId, date: '2026-01-01', cwd: '~', from: 3, to: 3, lastTurnFp: 'x', briefingStub: '' }
    };
    writeFileSync(INDEX, JSON.stringify({ ...before, pending: never }));
    writeTranscript(messages(3, 'unlanded'));

    expect(await capture(sessionId)).toMatchObject({ saved: true, turns: 1 });
    expect(occurrences('unlanded message 3')).toBe(1);
    expect(readIndex().pending).toBeUndefined();
  });

  test('a turn rewritten before the replay is written in its new form', async () => {
    const sessionId = '1a2b3c4d-0000-4000-8000-00000000dddd';
    writeTranscript(messages(2, 'revised'));
    await capture(sessionId);
    const before = readIndex();
    const offset = sizeOf(dayFile());
    writeTranscript(messages(3, 'revised'));
    await capture(sessionId);
    writeFileSync(INDEX, JSON.stringify(stoppedAfterAppend(before, sessionId, offset)));
    writeTranscript([...messages(2, 'revised'), 'revised message 3, edited']);

    expect((await capture(sessionId)).saved).toBe(true);
    expect(occurrences('revised message 3, edited')).toBe(1);
  });

  test('turns after a rewrite to a shorter transcript are kept, whatever older blocks the day file holds', async () => {
    const sessionId = '1a2b3c4d-0000-4000-8000-00000000eeee';
    writeTranscript(messages(5, 'compact'));
    await capture(sessionId, 'pre-compact');
    writeTranscript(messages(2, 'fresh'));
    await capture(sessionId);
    writeTranscript(messages(5, 'fresh'));

    expect(await capture(sessionId)).toMatchObject({ saved: true, turns: 3 });
    expect(occurrences('fresh message 5')).toBe(1);
  });

  test('an index that agrees with the day file still captures only the new turns', async () => {
    const sessionId = '1a2b3c4d-0000-4000-8000-00000000ffff';
    writeTranscript(messages(2, 'agree'));
    await capture(sessionId);
    writeTranscript(messages(4, 'agree'));
    expect(await capture(sessionId)).toMatchObject({ saved: true, turns: 2 });
  });
});
