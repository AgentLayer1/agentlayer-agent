import { expect, spyOn, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { FILES } from '@/config';
import { runHeartbeatCommand } from './command';
import { parseHeartbeat, readHeartbeat, type Heartbeat } from './ledger';
import { lastRefreshed, parseEvery, refreshDue, released } from './rules';

const NOW = new Date('2026-11-20T10:00:00+08:00');

const quietly = <T>(run: () => T): { result: T; lines: string[] } => {
  const said = spyOn(console, 'log').mockImplementation(() => {});
  try {
    const result = run();
    return { result, lines: said.mock.calls.map(([line]) => String(line)) };
  } finally {
    said.mockRestore();
  }
};

test('intervals read as minutes, within 5 minutes and a day', () => {
  expect(['15m', '15 mins', '1h', '2 hours', '90 minutes'].map(parseEvery)).toEqual([15, 15, 60, 120, 90]);
  expect(parseEvery('2m')).toBeInstanceOf(Error);
  expect(parseEvery('25h')).toBeInstanceOf(Error);
  expect(parseEvery('soon')).toBeInstanceOf(Error);
});

test('a refresh is due six hours after the later of the last sync and the last refresh, and at once when neither ran', () => {
  const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
  expect(lastRefreshed(hoursAgo(9), hoursAgo(2))).toBe(hoursAgo(2));
  expect(lastRefreshed(hoursAgo(1), undefined)).toBe(hoursAgo(1));
  expect(lastRefreshed(undefined, undefined)).toBe('');
  expect(refreshDue('', NOW)).toBe(true);
  expect(refreshDue(hoursAgo(5.99), NOW)).toBe(false);
  expect(refreshDue(hoursAgo(6), NOW)).toBe(true);
});

test('a heartbeat read back keeps the places it can use, and an exiting one releases only the claim it still holds', () => {
  const beat = parseHeartbeat({
    owner: 's-1',
    everyMinutes: 55,
    places: [{ adapter: 'cmux', surfaceId: 'a', workspaceId: 'b' }, 7]
  });
  expect(beat).toEqual({
    owner: 's-1',
    everyMinutes: 55,
    places: [{ adapter: 'cmux', surfaceId: 'a', workspaceId: 'b' }]
  });
  expect(parseHeartbeat('nonsense')).toBeNull();
  expect(released(beat, 's-1')).toBeNull();
  expect(released(beat, 's-2')).toBe(beat);
});

test('binding a new owner says it replaced the one before; rebinding the same owner, or one released, does not', () => {
  rmSync(FILES.HEARTBEAT, { force: true });
  try {
    const { lines } = quietly(() => {
      runHeartbeatCommand('bind', ['--owner=first']);
      runHeartbeatCommand('bind', ['--owner=first', '--every=15m']);
      runHeartbeatCommand('bind', ['--owner=second']);
      runHeartbeatCommand('release', ['--owner=first']);
      expect(readHeartbeat()?.owner, 'first no longer holds it').toBe('second');
      runHeartbeatCommand('release', ['--owner=second']);
      expect(readHeartbeat(), 'released, the file is gone').toBeNull();
      runHeartbeatCommand('bind', ['--owner=third']);
    });
    expect(lines.map((line) => line.includes('replaced an earlier heartbeat'))).toEqual([false, false, true, false]);
    expect(readHeartbeat()?.owner).toBe('third');
    quietly(() => runHeartbeatCommand('off', []));
    expect(readHeartbeat()).toBeNull();
  } finally {
    rmSync(FILES.HEARTBEAT, { force: true });
  }
});

test('the status a tick reads holds the heartbeat, the brain, and the room for proposals and notes', () => {
  rmSync(FILES.HEARTBEAT, { force: true });
  try {
    quietly(() => runHeartbeatCommand('bind', ['--owner=t', '--every=15m']));
    const { result, lines } = quietly(() => runHeartbeatCommand('status', ['--json']));
    expect(result).toBe(0);
    const status = JSON.parse(lines[0] ?? '');
    expect(status.heartbeat).toMatchObject({ owner: 't', everyMinutes: 15 });
    expect(Object.keys(status).toSorted()).toEqual([
      'heartbeat',
      'notes',
      'proposals',
      'refreshDue',
      'refreshedAt',
      'timezone'
    ]);
    expect(Object.keys(status.proposals).toSorted()).toEqual(['room', 'showing', 'target']);
    expect(Object.keys(status.notes).toSorted()).toEqual(['cap', 'room', 'today']);
  } finally {
    rmSync(FILES.HEARTBEAT, { force: true });
  }
});

test("a heartbeat file that won't parse fails the status and is never written over", () => {
  mkdirSync(dirname(FILES.HEARTBEAT), { recursive: true });
  writeFileSync(FILES.HEARTBEAT, '{"owner": ');
  try {
    const failed = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(runHeartbeatCommand('status', ['--json'])).toBe(1);
      expect(() => quietly(() => runHeartbeatCommand('bind', ['--owner=t']))).toThrow('is not valid JSON');
    } finally {
      failed.mockRestore();
    }
    expect(readFileSync(FILES.HEARTBEAT, 'utf-8')).toBe('{"owner": ');
  } finally {
    rmSync(FILES.HEARTBEAT, { force: true });
  }
});

test('proposals and notes know nothing of the heartbeat', () => {
  const offenders = ['proposals', 'notes'].flatMap((domain) => {
    const dir = resolve(import.meta.dir, '..', domain);
    return readdirSync(dir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => readFileSync(resolve(dir, name), 'utf-8').includes("from '@/heartbeat/"))
      .map((name) => `${domain}/${name}`);
  });
  expect(offenders).toEqual([]);
});

test("a 1.0.9 home's heartbeat, kept in proposals.json, moves into its own file on the first read", () => {
  rmSync(FILES.HEARTBEAT, { force: true });
  mkdirSync(dirname(FILES.PROPOSALS), { recursive: true });
  const beat: Heartbeat = {
    owner: 'old@1',
    everyMinutes: 55,
    places: [{ adapter: 'cmux', surfaceId: 's', workspaceId: 'w' }]
  };
  writeFileSync(FILES.PROPOSALS, JSON.stringify({ heartbeat: beat, proposals: [] }));
  try {
    expect(readHeartbeat()).toEqual(beat);
    expect(JSON.parse(readFileSync(FILES.HEARTBEAT, 'utf-8')), 'now in its own file').toEqual(beat);
    expect(Object.keys(JSON.parse(readFileSync(FILES.PROPOSALS, 'utf-8'))), 'and gone from the proposals').toEqual([
      'proposals'
    ]);
    quietly(() => runHeartbeatCommand('off', []));
    expect(readHeartbeat(), 'off stays off').toBeNull();
  } finally {
    rmSync(FILES.HEARTBEAT, { force: true });
    rmSync(FILES.PROPOSALS, { force: true });
  }
});

test("a notes file that won't parse stops the scouting, never the looks: the status reads, with no room for notes", () => {
  rmSync(FILES.HEARTBEAT, { force: true });
  mkdirSync(dirname(FILES.NOTES), { recursive: true });
  writeFileSync(FILES.NOTES, '{"notes": [');
  try {
    const { result, lines } = quietly(() => runHeartbeatCommand('status', ['--json']));
    expect(result).toBe(0);
    expect(JSON.parse(lines[0] ?? '').notes.room).toBe(0);
  } finally {
    rmSync(FILES.NOTES, { force: true });
  }
});
