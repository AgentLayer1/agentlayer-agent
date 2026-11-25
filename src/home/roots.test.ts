import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homeInRoots } from '@/home/roots';
import { HOME_MARKER_FILES, PLUGIN_SOURCE_ROOT, RUNTIME_DIR, pluginName } from '@/shared/naming';

const SCRATCH = realpathSync(mkdtempSync(join(tmpdir(), 'roots-')));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const HOME = join(SCRATCH, 'Nova');
mkdirSync(join(HOME, RUNTIME_DIR), { recursive: true });
mkdirSync(join(HOME, 'projects', 'acme'), { recursive: true });
writeFileSync(join(HOME, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
const ELSEWHERE = join(SCRATCH, 'elsewhere');
mkdirSync(ELSEWHERE);

describe('homeInRoots', () => {
  test('the first root inside a home names it, from any folder in it', () => {
    const uris = [pathToFileURL(ELSEWHERE).href, pathToFileURL(join(HOME, 'projects', 'acme')).href];
    expect(homeInRoots(uris)).toBe(HOME);
  });

  test('no root in a home, or no file root, names none', () => {
    expect(homeInRoots([pathToFileURL(ELSEWHERE).href, 'https://acme.example/repo'])).toBeUndefined();
  });
});

interface Message {
  id?: number | string;
  method?: string;
  result?: { content?: { text?: string }[] };
}

/** The real server, started as an Antigravity plugin starts it, driven by a client that does or doesn't offer roots. */
const pingThroughServer = async (offerRoots: boolean): Promise<{ ok: boolean; home: string }> => {
  const proc = Bun.spawn([process.execPath, resolve(PLUGIN_SOURCE_ROOT, 'src', 'server.ts'), '--home-from-roots'], {
    cwd: ELSEWHERE,
    env: { PATH: dirname(process.execPath), HOME: join(SCRATCH, 'user'), PLAYWRIGHT_BROWSERS_PATH: '0' },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore'
  });
  const send = (message: Record<string, unknown>): void => {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };
  const reader = proc.stdout.getReader();
  let buffer = '';
  const next = async (): Promise<Message> => {
    while (!buffer.includes('\n')) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error('the server closed its output');
      }
      buffer += new TextDecoder().decode(value);
    }
    const [line = '', ...rest] = buffer.split('\n');
    buffer = rest.join('\n');
    return JSON.parse(line) as Message;
  };
  const answerTo = async (id: number): Promise<Message> => {
    const message = await next();
    if (message.method === 'roots/list' && message.id !== undefined) {
      send({ id: message.id, result: { roots: [{ uri: pathToFileURL(join(HOME, 'projects')).href }] } });
    }
    return message.id === id && message.method === undefined ? message : answerTo(id);
  };
  try {
    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: offerRoots ? { roots: { listChanged: true } } : {},
        clientInfo: { name: 'acme-client', version: '1.0.0' }
      }
    });
    await answerTo(1);
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/call', params: { name: 'ping', arguments: {} } });
    const reply = await answerTo(2);
    const answer = JSON.parse(reply.result?.content?.[0]?.text ?? '{}') as { ok: boolean; paths: { home: string } };
    return { ok: answer.ok, home: answer.paths.home };
  } finally {
    proc.kill();
  }
};

describe('a server started with --home-from-roots', () => {
  test("acts on the home the client's roots name", async () => {
    expect(await pingThroughServer(true)).toEqual({ ok: true, home: HOME });
  }, 30_000);

  test('acts on no home when the client offers no roots', async () => {
    expect((await pingThroughServer(false)).ok).toBe(false);
  }, 30_000);
});
