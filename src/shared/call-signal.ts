import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<AbortSignal>();

/**
 * Runs a tool call with its cancel signal reachable from anywhere inside it (a handler, the gh and git runners)
 * without threading it through every function in between.
 */
export const withCallSignal = <T>(signal: AbortSignal, run: () => T): T => store.run(signal, run);

export const callSignal = (): AbortSignal | undefined => store.getStore();

const FETCH_TIMEOUT_MS = 60_000;

/** For an outbound request: the call's cancel, plus a deadline so a hung upstream can't hold the call open. */
export const fetchSignal = (timeoutMs: number = FETCH_TIMEOUT_MS): AbortSignal => {
  const call = callSignal();
  const deadline = AbortSignal.timeout(timeoutMs);
  return call ? AbortSignal.any([call, deadline]) : deadline;
};
