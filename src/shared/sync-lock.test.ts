import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FILES } from '@/config';
import { releaseSyncLock, SyncKind, type SyncLockResult, syncRunning, takeSyncLock, touchSyncLock } from './sync-lock';

const MINUTE_MS = 60 * 1000;

const ageLock = (minutes: number): void => {
  const then = new Date(Date.now() - minutes * MINUTE_MS);
  utimesSync(FILES.SYNC_LOCK, then, then);
};

const tokenOf = (result: SyncLockResult): string => (result.taken ? result.token : '');

const holderKind = (result: SyncLockResult): string | null => (result.taken ? null : result.holder.kind);

beforeEach(() => {
  mkdirSync(dirname(FILES.SYNC_LOCK), { recursive: true });
  rmSync(FILES.SYNC_LOCK, { force: true });
});

afterEach(() => {
  rmSync(FILES.SYNC_LOCK, { force: true });
});

test('one run holds the lock: a second sync or a refresh is told who holds it, until the first releases it', () => {
  const first = takeSyncLock(SyncKind.Sync);
  expect(first.taken).toBe(true);
  expect(syncRunning()).toBe(true);
  expect(holderKind(takeSyncLock(SyncKind.Refresh))).toBe(SyncKind.Sync);

  expect(releaseSyncLock(tokenOf(first))).toBe(true);
  expect(existsSync(FILES.SYNC_LOCK)).toBe(false);
  expect(syncRunning()).toBe(false);
  expect(takeSyncLock(SyncKind.Refresh).taken).toBe(true);
});

test('a release only frees the lock its own run holds', () => {
  const first = takeSyncLock(SyncKind.Sync);
  expect(releaseSyncLock('someone-else')).toBe(false);
  expect(syncRunning()).toBe(true);
  expect(releaseSyncLock(tokenOf(first))).toBe(true);
  expect(releaseSyncLock(tokenOf(first))).toBe(false);
});

test('a run that stopped frees the lock after an hour without progress, and progress keeps a long run live', () => {
  const stopped = takeSyncLock(SyncKind.Sync);
  ageLock(59);
  expect(takeSyncLock(SyncKind.Sync).taken).toBe(false);

  touchSyncLock();
  ageLock(30);
  expect(syncRunning()).toBe(true);

  ageLock(60);
  expect(syncRunning()).toBe(false);
  expect(takeSyncLock(SyncKind.Sync).taken).toBe(true);
  expect(releaseSyncLock(tokenOf(stopped))).toBe(false);
  expect(syncRunning()).toBe(true);
});

test('the operator can take over a live lock, and the run it replaced can no longer free it', () => {
  const stopped = takeSyncLock(SyncKind.Sync);
  const taken = takeSyncLock(SyncKind.Sync, { takeOver: true });
  expect(taken.taken).toBe(true);
  expect(releaseSyncLock(tokenOf(stopped))).toBe(false);
  expect(releaseSyncLock(tokenOf(taken))).toBe(true);
});

test('a lock file that will not parse still holds until it goes an hour untouched', () => {
  writeFileSync(FILES.SYNC_LOCK, '{ half');
  expect(holderKind(takeSyncLock(SyncKind.Sync))).toBe('unknown');
  ageLock(61);
  expect(takeSyncLock(SyncKind.Sync).taken).toBe(true);
});

test('touching with no run holding the lock creates nothing', () => {
  touchSyncLock();
  expect(existsSync(FILES.SYNC_LOCK)).toBe(false);
});
