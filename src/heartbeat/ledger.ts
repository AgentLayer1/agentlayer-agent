import { FILES } from '@/config';
import { readProposalLedger, writeProposalLedger } from '@/proposals/ledger';
import { parsePlace, type SessionPlace } from '@/sessions/launch';
import { isRecord } from '@/shared/json-block';
import { jsonProblem, writeJsonChecked } from '@/shared/utils';
import { existsSync, readFileSync, rmSync } from 'node:fs';

/**
 * The session that keeps the home's work coming, by the token its process chose, and the places launchers can reach it.
 */
export interface Heartbeat {
  owner: string;
  places: SessionPlace[];
  everyMinutes: number;
}

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

const parseFile = (path: string, pick: (data: Record<string, unknown>) => unknown): Heartbeat | null => {
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return isRecord(data) ? parseHeartbeat(pick(data)) : null;
  } catch {
    return null;
  }
};

/**
 * The home's heartbeat, or null when no session is one. A home on 1.0.9 kept it under proposals.json's `heartbeat`;
 * the first read moves it into its own file, so a heartbeat bound before the upgrade keeps its place.
 */
export const readHeartbeat = (): Heartbeat | null => {
  if (existsSync(FILES.HEARTBEAT)) {
    return parseFile(FILES.HEARTBEAT, (data) => data);
  }
  const legacy = parseFile(FILES.PROPOSALS, (data) => data.heartbeat);
  if (legacy) {
    try {
      writeHeartbeat(legacy);
      writeProposalLedger(readProposalLedger());
    } catch {
      // A file that won't parse is left for the operator; the heartbeat still reads from where it was.
    }
  }
  return legacy;
};

/**
 * What's wrong with the heartbeat's file, or '' when it is missing or reads.
 */
export const heartbeatProblem = (): string => jsonProblem(FILES.HEARTBEAT);

/**
 * Records the heartbeat, or that there is none, unless the file won't parse: that one is left for the operator.
 */
export const writeHeartbeat = (beat: Heartbeat | null): void => {
  if (beat) {
    writeJsonChecked(FILES.HEARTBEAT, beat);
    return;
  }
  const problem = heartbeatProblem();
  if (problem) {
    throw new Error(problem);
  }
  rmSync(FILES.HEARTBEAT, { force: true });
};

/**
 * The heartbeat's place in one launcher's terms, or null when it has none there.
 */
export const placeOf = (beat: Heartbeat | null, adapter: SessionPlace['adapter']): SessionPlace | null =>
  beat?.places.find((place) => place.adapter === adapter) ?? null;
