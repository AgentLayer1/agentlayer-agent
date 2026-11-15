import { describe, expect, test } from 'bun:test';
import { fetchSignal, withCallSignal } from './call-signal';

describe('fetchSignal', () => {
  test('aborts when the tool call is cancelled', () => {
    const call = new AbortController();
    withCallSignal(call.signal, () => {
      const signal = fetchSignal();
      expect(signal.aborted).toBe(false);
      call.abort();
      expect(signal.aborted).toBe(true);
    });
  });

  test('aborts at its deadline with no call around it', async () => {
    const signal = fetchSignal(10);
    await Bun.sleep(40);
    expect(signal.aborted).toBe(true);
  });
});
