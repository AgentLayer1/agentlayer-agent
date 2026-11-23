import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';

/**
 * A capture appends its block to the day file, then saves the index. One that stops between the two leaves the index
 * a block behind, and the next capture of that session must not write the block again.
 */
const HOME = mkdtempSync(resolve(tmpdir(), 'capture-replay-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

const SESSIONS = resolve(HOME, 'knowledge', 'raw', 'sessions');
const INDEX = resolve(SESSIONS, 'index.json');
const SAVED_INDEX = resolve(HOME, 'index-before.json');
const transcriptPath = resolve(HOME, 'transcript.jsonl');

let captureSession: typeof import('@/knowledge/session-capture').captureSession;

const writeTranscript = (turns: number): void => {
  const lines = Array.from({ length: turns }, (_unused, index) =>
    JSON.stringify({
      message: { role: index % 2 === 0 ? 'user' : 'assistant', content: `replay message ${index + 1}` }
    })
  );
  writeFileSync(transcriptPath, lines.join('\n'), 'utf-8');
};

const capture = (sessionId: string) => captureSession({ transcriptPath, cwd: HOME, sessionId, mode: 'session-end' });
const occurrences = (filename: string, text: string): number =>
  readFileSync(resolve(SESSIONS, filename), 'utf-8').split(text).length - 1;

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
  test('a later turn whose index save was lost is not written again', async () => {
    const sessionId = '1a2b3c4d-0000-4000-8000-00000000aaaa';
    writeTranscript(2);
    expect((await capture(sessionId)).saved).toBe(true);
    copyFileSync(INDEX, SAVED_INDEX);
    writeTranscript(3);
    const third = await capture(sessionId);
    expect(third.saved).toBe(true);
    copyFileSync(SAVED_INDEX, INDEX);

    const replayed = await capture(sessionId);
    expect(replayed).toMatchObject({ saved: false, reason: 'no-new-turns' });
    expect(occurrences(`${third.saved && third.filename}`, 'replay message 3')).toBe(1);
    expect(JSON.parse(readFileSync(INDEX, 'utf-8')).sessions[sessionId].captured_turns).toBe(3);
  });

  test('a first capture whose index save was lost is not written again', async () => {
    const sessionId = '1a2b3c4d-0000-4000-8000-00000000bbbb';
    const before = readFileSync(INDEX, 'utf-8');
    writeTranscript(2);
    const first = await capture(sessionId);
    expect(first.saved).toBe(true);
    writeFileSync(INDEX, before);

    expect(await capture(sessionId)).toMatchObject({ saved: false, reason: 'no-new-turns' });
    expect(occurrences(`${first.saved && first.filename}`, `[${sessionId}]`)).toBe(1);
  });

  test('an index that agrees with the day file still captures only the new turns', async () => {
    const sessionId = '1a2b3c4d-0000-4000-8000-00000000cccc';
    writeTranscript(2);
    await capture(sessionId);
    writeTranscript(4);
    expect(await capture(sessionId)).toMatchObject({ saved: true, turns: 2 });
  });
});
