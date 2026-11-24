import { FILES } from '@/config';
import { nowISO } from '@/shared/date';
import { isRecord } from '@/shared/json-block';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';

/**
 * A lock nobody has touched for this long belongs to a run that stopped (interrupted, crashed, the machine slept
 * through it), so the next run takes it. Progress touches it, so a long run stays live.
 */
const IDLE_MS = 60 * 60 * 1000;

export const SyncKind = { Sync: 'sync', Refresh: 'refresh', Compile: 'compile' } as const;
export type SyncKind = (typeof SyncKind)[keyof typeof SyncKind];

interface SyncHolder {
  /** `unknown` when the lock file won't parse. */
  kind: SyncKind | 'unknown';
  startedAt: string;
  lastProgressAt: string;
  freesAt: string;
}

export type SyncLockResult = { taken: true; token: string } | { taken: false; holder: SyncHolder };

interface LockFile {
  token: string;
  kind: SyncKind;
  startedAt: string;
}

const isKind = (kind: unknown): kind is SyncKind => Object.values<unknown>(SyncKind).includes(kind);

const touchedMs = (): number | null => statSync(FILES.SYNC_LOCK, { throwIfNoEntry: false })?.mtimeMs ?? null;

const readLock = (): { lock: LockFile | null; touchedMs: number } | null => {
  const touched = touchedMs();
  if (touched === null) {
    return null;
  }
  const lock = (() => {
    try {
      const data: unknown = JSON.parse(readFileSync(FILES.SYNC_LOCK, 'utf-8'));
      return isRecord(data) && typeof data.token === 'string' && isKind(data.kind) && typeof data.startedAt === 'string'
        ? { token: data.token, kind: data.kind, startedAt: data.startedAt }
        : null;
    } catch {
      return null;
    }
  })();
  return { lock, touchedMs: touched };
};

const holderOf = ({ lock, touchedMs }: { lock: LockFile | null; touchedMs: number }): SyncHolder => {
  const touched = nowISO(new Date(touchedMs));
  return {
    kind: lock?.kind ?? 'unknown',
    startedAt: lock?.startedAt ?? touched,
    lastProgressAt: touched,
    freesAt: nowISO(new Date(touchedMs + IDLE_MS))
  };
};

const isStale = (touched: number, now: number): boolean => now - touched >= IDLE_MS;

const create = (kind: SyncKind): string | null => {
  const token = randomUUID();
  const lock: LockFile = { token, kind, startedAt: nowISO() };
  try {
    writeFileSync(FILES.SYNC_LOCK, `${JSON.stringify(lock)}\n`, { flag: 'wx' });
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return null;
    }
    throw error;
  }
};

/**
 * Start a sync, a brain refresh or a compile: take the home's one sync lock, or say who holds it. A stale lock is taken over, and
 * `takeOver` takes a live one (the operator knows that run was stopped).
 */
export const takeSyncLock = (kind: SyncKind, options: { takeOver?: boolean } = {}): SyncLockResult => {
  const held = readLock();
  if (held && !options.takeOver && !isStale(held.touchedMs, Date.now())) {
    return { taken: false, holder: holderOf(held) };
  }
  if (held) {
    rmSync(FILES.SYNC_LOCK, { force: true });
  }
  const token = create(kind);
  // No token: another run took it since the read.
  return token
    ? { taken: true, token }
    : { taken: false, holder: holderOf(readLock() ?? { lock: null, touchedMs: Date.now() }) };
};

/**
 * End the run holding `token`. A lock someone else has taken since is left alone; returns whether this run's was freed.
 */
export const releaseSyncLock = (token: string): boolean => {
  if (readLock()?.lock?.token !== token) {
    return false;
  }
  rmSync(FILES.SYNC_LOCK, { force: true });
  return true;
};

/**
 * The running sync made progress, so its lock stays live. Nothing to touch when no run holds it.
 */
export const touchSyncLock = (): void => {
  try {
    const now = new Date();
    utimesSync(FILES.SYNC_LOCK, now, now);
  } catch {
    // No lock held, or one released between the check and the touch.
  }
};

/**
 * Whether a sync or a brain refresh is running now: a lock that isn't stale.
 */
export const syncRunning = (now: number = Date.now()): boolean => {
  const touched = touchedMs();
  return touched !== null && !isStale(touched, now);
};
