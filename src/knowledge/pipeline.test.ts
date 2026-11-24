import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { AGENT_SLUG } from '@/config';
import { RUNTIME_DIR, pluginName } from '@/shared/naming';

// One hermetic HOME for the whole pipeline, overriding the preload's throwaway home so
// capture and compile share a tree this file can assert against. `config` resolves paths live,
// so the ordering no longer matters for paths — but AGENT_TIMEZONE is still read once at config
// import, so it stays set at module scope, above the dynamic imports below. The compile suite
// resets state in its own beforeAll to isolate from capture.
const HOME = mkdtempSync(resolve(tmpdir(), `${AGENT_SLUG}-pipeline-`));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;
process.env.AGENT_TIMEZONE = 'Asia/Kuala_Lumpur';

const SESSIONS = resolve(HOME, 'knowledge', 'raw', 'sessions');
const transcriptPath = resolve(HOME, 'transcript.jsonl');

let captureSession: typeof import('@/knowledge/session-capture').captureSession;
let pickNext: typeof import('@/knowledge/compile').pickNext;
let markComplete: typeof import('@/knowledge/compile').markComplete;
let getStatus: typeof import('@/knowledge/compile').getStatus;
let hashBuffer: typeof import('@/knowledge/utils').hashBuffer;
let SESSION_INDEX: string;
let STATE_PATH: string;

beforeAll(async () => {
  mkdirSync(SESSIONS, { recursive: true });
  mkdirSync(resolve(HOME, RUNTIME_DIR), { recursive: true });
  writeFileSync(
    resolve(HOME, RUNTIME_DIR, 'version.json'),
    `${JSON.stringify({ plugin: pluginName() })}
`
  ); // isInitialized() gate — the marker file marks this agent's home
  ({ captureSession } = await import('@/knowledge/session-capture'));
  ({ pickNext, markComplete, getStatus } = await import('@/knowledge/compile'));
  ({ hashBuffer } = await import('@/knowledge/utils'));
  const { FILES } = await import('@/config');
  SESSION_INDEX = FILES.SESSION_INDEX;
  STATE_PATH = FILES.KNOWLEDGE_STATE;
});

afterAll(() => {
  // Restore the preload's home rather than deleting it — an unset AGENT_HOME would drop later
  // suites back to resolving from cwd.
  process.env.AGENT_HOME = PRELOAD_HOME;
  delete process.env.AGENT_TIMEZONE;
  rmSync(HOME, { recursive: true, force: true });
});

// ── Capture: incremental + resume-safe ───────────────────────────────

describe('captureSession', () => {
  const writeTranscript = (n: number) => {
    const lines = Array.from({ length: n }, (_unused, i) =>
      JSON.stringify({
        message: { role: i % 2 === 0 ? 'user' : 'assistant', content: `message number ${i + 1}` }
      })
    );
    writeFileSync(transcriptPath, lines.join('\n'), 'utf-8');
  };
  const capture = (mode: 'session-end' | 'pre-compact') =>
    captureSession({ transcriptPath, cwd: HOME, sessionId: 'deadbeefcafe', mode });

  let logPath = '';

  test('first capture writes all turns with a turn-range header', async () => {
    writeTranscript(8);
    const result = await capture('session-end');
    expect(result.saved).toBe(true);
    if (!result.saved) return;
    logPath = result.path;
    expect(result.turns).toBe(8);
    const log = readFileSync(logPath, 'utf-8');
    expect(log).toContain('[deadbeefcafe]');
    expect(log).toContain('turns 1–8');
    expect(log).toContain('message number 1');
    expect(log).toContain('message number 8');
  });

  test('re-capture with no new turns is a no-op (the double-dump fix)', async () => {
    const result = await capture('session-end');
    expect(result.saved).toBe(false);
    if (result.saved) return;
    expect(result.reason).toBe('no-new-turns');
  });

  test('resume appends only the delta — earlier turns are never re-dumped', async () => {
    writeTranscript(12);
    const result = await capture('session-end');
    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.turns).toBe(4);
    const log = readFileSync(logPath, 'utf-8');
    expect(log).toContain('turns 9–12');
    expect(log.match(/message number 1\b/g)).toHaveLength(1);
    expect(log.match(/turns 1–8/g)).toHaveLength(1);
  });

  test('the index tracks the cursor and turn coverage', () => {
    const index = JSON.parse(readFileSync(SESSION_INDEX, 'utf-8'));
    const rec = index.sessions.deadbeefcafe;
    expect(rec.captured_turns).toBe(12);
    expect(rec.blocks).toEqual([{ date: rec.last_seen, from: 1, to: 12 }]);
    expect(rec.briefing.length).toBeGreaterThan(0);
  });

  test('concurrent captures of the same new session write exactly one block (mutex)', async () => {
    writeTranscript(8);
    const fire = () => captureSession({ transcriptPath, cwd: HOME, sessionId: 'racer123beef', mode: 'session-end' });
    const results = await Promise.all([fire(), fire()]);
    // Exactly one writes; the serialized loser sees the cursor and skips.
    expect(results.filter((r) => r.saved).length).toBe(1);
    expect(results.filter((r) => !r.saved && r.reason === 'no-new-turns').length).toBe(1);
    const log = readFileSync(logPath, 'utf-8');
    expect(log.match(/\[racer123beef\]/g)).toHaveLength(1);
    const index = JSON.parse(readFileSync(SESSION_INDEX, 'utf-8'));
    expect(index.sessions.racer123beef.captured_turns).toBe(8);
    expect(index.sessions.racer123beef.blocks).toHaveLength(1);
  });

  test("the session's one-line briefing is redacted like its turns", async () => {
    const token = ['ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');
    const turns = [`use the token ${token} for the push`, 'done', 'next', 'ok'];
    writeFileSync(transcriptPath, turns.map((content, i) => JSON.stringify({ message: { role: i % 2 === 0 ? 'user' : 'assistant', content } })).join('\n'));
    const result = await captureSession({ transcriptPath, cwd: HOME, sessionId: 'briefcafe01', mode: 'session-end' });
    expect(result.saved).toBe(true);
    const index = readFileSync(SESSION_INDEX, 'utf-8');
    expect(index).toContain('<REDACTED:GITHUB_TOKEN>');
    expect(index).not.toContain(token);
  });

  test('a token far into the first turn, behind collapsible whitespace, is redacted whole in the briefing', async () => {
    const key = ['AKIA', 'Z7Q3XK2MBNTW5RLP'].join('');
    writeFileSync(transcriptPath, [`Hello ${' '.repeat(3_975)}${key} is the key`, 'ok'].map((content, i) => JSON.stringify({ message: { role: i === 0 ? 'user' : 'assistant', content } })).join('\n'));
    await captureSession({ transcriptPath, cwd: HOME, sessionId: 'briefcafe02', mode: 'session-end' });
    const briefing = (JSON.parse(readFileSync(SESSION_INDEX, 'utf-8')) as { sessions: Record<string, { briefing: string }> }).sessions.briefcafe02?.briefing ?? '';
    expect(briefing).toContain('<REDACTED:AWS_KEY_ID>');
    expect(briefing).not.toContain('AKIA');
  });

  test('a rewritten transcript no longer than the cursor is captured again, not skipped', async () => {
    writeTranscript(6);
    await captureSession({ transcriptPath, cwd: HOME, sessionId: 'shrunk00beef', mode: 'session-end' });
    const lines = Array.from({ length: 4 }, (_unused, i) => JSON.stringify({ message: { role: i % 2 === 0 ? 'user' : 'assistant', content: `rewritten turn ${i + 1}` } }));
    writeFileSync(transcriptPath, lines.join('\n'));
    const result = await captureSession({ transcriptPath, cwd: HOME, sessionId: 'shrunk00beef', mode: 'session-end' });
    expect(result.saved).toBe(true);
    expect(readFileSync(logPath, 'utf-8')).toContain('rewritten turn 4');
  });

  test('a damaged deferred-capture line costs only that line, never the capture running now', async () => {
    const pending = resolve(HOME, RUNTIME_DIR, 'capture-pending.jsonl');
    writeTranscript(4);
    writeFileSync(pending, '{"transcriptPath": "/nowhere", "sessionId": \n');
    const result = await captureSession({ transcriptPath, cwd: HOME, sessionId: 'drained0beef', mode: 'session-end' });
    expect(result.saved).toBe(true);
    expect(readFileSync(logPath, 'utf-8')).toContain('[drained0beef]');
  });
});

// ── Compile: incremental, today-inclusive, corruption-safe ───────────

describe('incremental compile', () => {
  const dayFile = resolve(SESSIONS, '2026-06-01.md');
  const legacyFile = resolve(SESSIONS, '2026-05-30.md');
  const entry = (time: string, id: string, range: string, topic: string) =>
    `### Session (${time}) [${id}] · 2026-06-01 · ~/Kevin · turns ${range}\n\n` +
    `**User:** ${topic} discussion\n\n**Assistant:** about the ${topic}\n\n---\n\n`;

  beforeAll(() => {
    // Isolate from the capture suite: fresh sessions dir + empty compile state.
    rmSync(SESSIONS, { recursive: true, force: true });
    mkdirSync(SESSIONS, { recursive: true });
    rmSync(STATE_PATH, { force: true });
    // A distinctive name so the prompt assertion below proves the value came
    // from IDENTITY.md, rather than matching the plugin-derived fallback.
    writeFileSync(
      resolve(HOME, 'IDENTITY.md'),
      '# Identity\n\n## Who\n\n- **Name:** Testbot\n- **Formerly:** Scout\n',
      'utf-8'
    );
    writeFileSync(dayFile, `# Session Log: 2026-06-01\n\n${entry('09:00', 'aaa11111', '1–2', 'first topic')}`, 'utf-8');
  });

  test("today's file is compiled immediately (no ignore-today)", async () => {
    const item = await pickNext();
    expect(item).not.toBeNull();
    expect(item?.fileName).toBe('2026-06-01.md');
    expect(item?.prompt).toContain('first topic');
    // The compile prompt names the agent, and that name is written into compiled
    // memory. An unresolved {{agentName}} would teach the wiki the wrong name.
    expect(item?.prompt).toContain('Testbot');
    expect(item?.prompt).not.toContain('{{');
    // Raw input from before a rename says the old name; the compiler must read it as this agent.
    expect(item?.prompt).toContain('this agent was called Scout');
    // The operator's own turn is listed with the session and date a correction in it would be keyed on.
    expect(item?.prompt).toContain('- session `aaa11111` · date `2026-06-01` · first topic discussion');
    expect((await markComplete(item!.itemId)).promoted).toBe(true);
  });

  test('a fully-compiled file is no longer pending; cursor stored as bytes', async () => {
    expect(await pickNext()).toBeNull();
    expect((await getStatus()).pending.sessions).toBe(0);
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    expect(state.ingested['2026-06-01.md'].bytes).toBeGreaterThan(0);
  });

  test('appending an entry makes only the delta pending', async () => {
    appendFileSync(dayFile, entry('11:00', 'aaa11111', '3–4', 'second topic'), 'utf-8');
    const item = await pickNext();
    expect(item?.prompt).toContain('second topic');
    expect(item?.prompt).not.toContain('first topic');
    expect((item?.meta.sliceStart as number) > 0).toBe(true);
    expect((await markComplete(item!.itemId)).promoted).toBe(true);
    expect(await pickNext()).toBeNull();
  });

  test('corruption guard: editing the compiled prefix forces a from-scratch recompile', async () => {
    writeFileSync(dayFile, readFileSync(dayFile, 'utf-8').replace('first topic discussion', 'EDITED PREFIX'), 'utf-8');
    const item = await pickNext();
    expect(item?.meta.sliceStart).toBe(0);
    expect(item?.prompt).toContain('EDITED PREFIX');
    await markComplete(item!.itemId);
    expect(await pickNext()).toBeNull();
  });

  test('legacy record (no bytes) skips an unchanged file, recompiles a changed one', async () => {
    writeFileSync(
      legacyFile,
      `# Session Log: 2026-05-30\n\n${entry('08:00', 'bbb22222', '1–2', 'legacy topic')}`,
      'utf-8'
    );
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    state.ingested['2026-05-30.md'] = {
      hash: hashBuffer(readFileSync(legacyFile)),
      compiled_at: '2026-05-30T00:00:00+08:00',
      cost_usd: 0
    };
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
    expect(await pickNext()).toBeNull(); // unchanged legacy → skipped

    appendFileSync(legacyFile, entry('09:30', 'bbb22222', '3–4', 'legacy addition'), 'utf-8');
    const item = await pickNext();
    expect(item?.fileName).toBe('2026-05-30.md');
    expect(item?.meta.sliceStart).toBe(0);
    await markComplete(item!.itemId);
    expect(await pickNext()).toBeNull();
  });
});

describe('feedback compile', () => {
  test('an entry appended between compile_next and compile_write is still pending afterwards', async () => {
    const { FILES } = await import('@/config');
    mkdirSync(resolve(HOME, 'knowledge', 'raw', 'user'), { recursive: true });
    writeFileSync(FILES.FEEDBACK, '# Feedback\n\n- first lesson\n');
    let item = await pickNext();
    while (item && item.kind !== 'feedback') {
      await markComplete(item.itemId);
      item = await pickNext();
    }
    expect(item?.kind).toBe('feedback');
    appendFileSync(FILES.FEEDBACK, '- a lesson logged mid-compile\n');
    await markComplete('feedback');
    expect((await getStatus()).pending.feedback).toBe(1);
    rmSync(FILES.FEEDBACK, { force: true });
  });
});
