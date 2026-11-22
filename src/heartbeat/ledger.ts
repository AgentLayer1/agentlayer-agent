import { FILES } from '@/config';
import type { SessionPlace } from '@/sessions/launch';
import { isRecord } from '@/shared/json-block';
import { isUnreadable, writeJsonAtomic } from '@/shared/utils';
import { readFileSync, rmSync } from 'node:fs';

/**
 * The session that keeps the home's work coming, by the token its process chose, and the places launchers can reach it.
 */
export interface Heartbeat {
  owner: string;
  places: SessionPlace[];
  everyMinutes: number;
}

const parsePlace = (data: unknown): SessionPlace | null =>
  isRecord(data) &&
  data.adapter === 'cmux' &&
  typeof data.surfaceId === 'string' &&
  typeof data.workspaceId === 'string'
    ? { adapter: 'cmux', surfaceId: data.surfaceId, workspaceId: data.workspaceId }
    : null;

export const parseHeartbeat = (data: unknown): Heartbeat | null => {
  if (!isRecord(data) || typeof data.owner !== 'string' || typeof data.everyMinutes !== 'number') {
    return null;
  }
  const places = Array.isArray(data.places) ? data.places.map(parsePlace) : [];
  return {
    owner: data.owner,
    everyMinutes: data.everyMinutes,
    places: places.filter((place): place is SessionPlace => place !== null)
  };
};

/**
 * The home's heartbeat, or null when no session is one.
 */
export const readHeartbeat = (): Heartbeat | null => {
  try {
    return parseHeartbeat(JSON.parse(readFileSync(FILES.HEARTBEAT, 'utf-8')));
  } catch {
    return null;
  }
};

/**
 * What's wrong with the heartbeat's file, or '' when it is missing or reads.
 */
export const heartbeatProblem = (): string =>
  isUnreadable(FILES.HEARTBEAT) ? `${FILES.HEARTBEAT} is not valid JSON; fix or remove it, then try again.` : '';

/**
 * Records the heartbeat, or that there is none, unless the file won't parse: that one is left for the operator.
 */
export const writeHeartbeat = (beat: Heartbeat | null): void => {
  const problem = heartbeatProblem();
  if (problem) {
    throw new Error(problem);
  }
  if (beat) {
    writeJsonAtomic(FILES.HEARTBEAT, beat);
  } else {
    rmSync(FILES.HEARTBEAT, { force: true });
  }
};
