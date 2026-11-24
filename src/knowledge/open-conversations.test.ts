import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { todayDate } from '@/shared/date';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';

/**
 * A host with no session-end event records its conversations, and the drain at every session start saves what a
 * turn-end capture never reached.
 */
const HOME = mkdtempSync(join(tmpdir(), 'open-conversations-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

const SESSIONS = resolve(HOME, 'knowledge', 'raw', 'sessions');
const OPEN = resolve(HOME, RUNTIME_DIR, 'conversations', 'open.json');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let capture: typeof import('@/knowledge/session-capture');

const transcript = (id: string, turns: number, ageMs = 0): string => {
  const path = resolve(HOME, `${id}.jsonl`);
  const steps = Array.from({ length: turns }, (_unused, index) =>
    index % 2 === 0
      ? { type: 'USER_INPUT', content: `<USER_REQUEST>\n${id} turn ${index + 1}\n</USER_REQUEST>` }
      : { type: 'PLANNER_RESPONSE', model: 'gemini-test', content: `${id} turn ${index + 1}` }
  );
  writeFileSync(path, `${steps.map((step) => JSON.stringify(step)).join('\n')}\n`);
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
  return path;
};
const record = (id: string, path: string) =>
  capture.recordConversation({ sessionId: id, transcriptPath: path, cwd: HOME }, 'antigravity');
const open = (): Record<string, { ackedSize: number }> =>
  existsSync(OPEN) ? (JSON.parse(readFileSync(OPEN, 'utf-8')) as Record<string, { ackedSize: number }>) : {};
const saved = (text: string): number => {
  const day = resolve(SESSIONS, `${todayDate()}.md`);
  return existsSync(day) ? readFileSync(day, 'utf-8').split(text).length - 1 : 0;
};

beforeAll(async () => {
  mkdirSync(resolve(HOME, RUNTIME_DIR), { recursive: true });
  writeFileSync(resolve(HOME, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
  capture = await import('@/knowledge/session-capture');
});

beforeEach(() => {
  rmSync(OPEN, { force: true });
  rmSync(SESSIONS, { recursive: true, force: true });
  mkdirSync(SESSIONS, { recursive: true });
  rmSync(resolve(SESSIONS, 'index.json'), { force: true });
});

afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  if (PRELOAD_HOME === undefined) delete process.env.AGENT_HOME;
  else process.env.AGENT_HOME = PRELOAD_HOME;
});

describe('open conversations', () => {
  test('a conversation is recorded once', async () => {
    const path = transcript('once', 2);
    await record('once', path);
    await record('once', path);
    expect(Object.keys(open())).toEqual(['once']);
    expect(open().once?.ackedSize).toBe(0);
  });

  test('a quiet conversation is saved and acknowledged, and a second drain writes nothing', async () => {
    const path = transcript('quiet', 4, 11 * MINUTE);
    await record('quiet', path);
    await capture.drainOpenConversations();
    expect(saved('quiet turn 4')).toBe(1);
    expect(open().quiet?.ackedSize).toBeGreaterThan(0);
    await capture.drainOpenConversations();
    expect(saved('quiet turn 4')).toBe(1);
  });

  test('a conversation still going is left for a later drain', async () => {
    await record('live', transcript('live', 4));
    await capture.drainOpenConversations();
    expect(saved('live turn')).toBe(0);
    expect(open().live?.ackedSize).toBe(0);
  });

  test('one idle for two weeks with turns not yet saved is saved, then retired', async () => {
    await record('stale', transcript('stale', 2, 15 * DAY));
    await capture.drainOpenConversations();
    expect(saved('stale turn 2')).toBe(1);
    expect(open().stale).toBeUndefined();
  });

  test('one whose transcript is gone is dropped', async () => {
    const path = transcript('gone', 2, 11 * MINUTE);
    await record('gone', path);
    rmSync(path);
    await capture.drainOpenConversations();
    expect(open().gone).toBeUndefined();
  });

  test('a turn-end capture waits for ten new turns', async () => {
    const few = await capture.captureSession({
      transcriptPath: transcript('turns', 4),
      cwd: HOME,
      sessionId: 'turns',
      mode: 'turn-end',
      format: 'antigravity'
    });
    expect(few).toMatchObject({ saved: false, reason: 'too-few-turns' });
    const enough = await capture.captureSession({
      transcriptPath: transcript('turns', 10),
      cwd: HOME,
      sessionId: 'turns',
      mode: 'turn-end',
      format: 'antigravity'
    });
    expect(enough).toMatchObject({ saved: true, turns: 10 });
  });
});
