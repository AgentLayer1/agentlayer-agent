import { describe, expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On } from 'claude-code';

import { HOME, NOW, PLUGIN, fakeHost, machine, run } from './fake-host';
import type { FakeHost } from './fake-host';

const MINUTE = 60_000;
const WAKE = `${PLUGIN}:heartbeat`;

const heartbeatHost = (on: On, heartbeat: FakeHost['proposals']['heartbeat'] = null) => {
  const host = fakeHost(on, machine({ proposals: { target: 5, waiting: [], heartbeat } }));
  const submitted: string[] = [];
  const filled: string[] = [];
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text);
    return { text: e.text };
  });
  on('prompt.fill', (_$, e) => {
    filled.push(e.text);
    return { isFilled: true, text: e.text, cursor: e.text.length };
  });
  on('turn.start', (_$, e) => ({ turnId: e.turnId }));
  return { host, submitted, filled };
};

const start = async ($: Engine, host: FakeHost) => {
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true });
  await host.clock.advance(0);
};

const cliCalls = (host: FakeHost) => host.argv.map((argv) => argv.slice(2).join(' ')).filter((args) => args.startsWith('proposals '));

describe('proposals', () => {
  test('/propose runs the decision through the CLI with no model turn', async ($, on) => {
    const { host } = heartbeatHost(on);
    const { text } = await run($, 'propose', 'start p-1');
    expect(text).toBe('ran proposals decide start p-1');
    expect(host.argv.at(-1)?.slice(2)).toEqual(['proposals', 'decide', 'start', 'p-1']);
    expect(host.cwd.at(-1)).toBe(HOME);
  });

  test('/propose without a choice and an id prints usage and decides nothing', async ($, on) => {
    const { host } = heartbeatHost(on);
    expect((await run($, 'propose', 'maybe p-1')).text).toBe('Usage: /propose <start|later|skip> <id>');
    expect(cliCalls(host)).toEqual([]);
  });

  test('a decision typed after a half-written prompt runs, never reaches the model, and gives the draft back', async ($, on) => {
    const { host, submitted, filled } = heartbeatHost(on);
    const result = await $.prompt.submit({ text: 'hello there/propose skip p-2' });
    await host.clock.settle();
    expect(result).toEqual({ drop: 'ran proposals decide skip p-2' });
    expect(submitted).toEqual([]);
    expect(filled).toEqual(['hello there']);
  });

  test('an ordinary prompt passes through untouched', async ($, on) => {
    const { submitted } = heartbeatHost(on);
    await $.prompt.submit({ text: 'what should I propose next?' });
    expect(submitted).toEqual(['what should I propose next?']);
  });

  test('/heartbeat makes this session the heartbeat, at an interval when one is given', async ($, on) => {
    const { host } = heartbeatHost(on);
    await run($, 'heartbeat');
    await run($, 'heartbeat', '15 mins');
    await run($, 'heartbeat', 'off');
    expect(cliCalls(host).filter((args) => !args.startsWith('proposals list'))).toEqual([
      'proposals heartbeat --session=session-1',
      'proposals heartbeat --session=session-1 --every=15 mins',
      'proposals heartbeat --off'
    ]);
  });

  test('the heartbeat wakes on its interval when the session is idle and proposals are short', async ($, on) => {
    const { host } = heartbeatHost(on, { sessionId: 'session-1', everyMinutes: 55 });
    await start($, host);
    await host.clock.advance(54 * MINUTE);
    expect(host.commands).toEqual([]);
    await host.clock.advance(MINUTE);
    expect(host.commands).toEqual([WAKE]);
  });

  test('a new interval replaces the old clock rather than adding one', async ($, on) => {
    const { host } = heartbeatHost(on, { sessionId: 'session-1', everyMinutes: 55 });
    await start($, host);
    await run($, 'heartbeat', '15m');
    await host.clock.advance(55 * MINUTE);
    expect(host.commands, 'three 15-minute wakes; a leftover 55-minute clock would add a fourth').toEqual([WAKE, WAKE, WAKE]);
  });

  test('another session that is the heartbeat costs this one nothing', async ($, on) => {
    const { host } = heartbeatHost(on, { sessionId: 'session-2', everyMinutes: 55 });
    await start($, host);
    await host.clock.advance(3 * 55 * MINUTE);
    expect(host.commands).toEqual([]);
  });

  test('a running turn or full proposals hold the wake', async ($, on) => {
    const { host } = heartbeatHost(on, { sessionId: 'session-1', everyMinutes: 55 });
    await start($, host);
    await $.turn.start({ text: '', turnId: 't1' });
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([]);
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' });
    host.proposals.waiting = Array.from({ length: 5 }, (_, index) => ({ id: `p-${index}`, title: 'x' }));
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([]);
    host.proposals.waiting = [];
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE]);
  });

  test('quiet hours hold the wake until morning', async ($, on) => {
    const { host } = heartbeatHost(on, { sessionId: 'session-1', everyMinutes: 55 });
    await host.clock.set(Date.parse('2026-03-10T23:10:00+08:00'));
    await start($, host);
    await host.clock.set(Date.parse('2026-03-11T06:59:00+08:00'));
    expect(host.commands).toEqual([]);
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE]);
  });

  test("the day's first wake clears the conversation first", async ($, on) => {
    const { host } = heartbeatHost(on, { sessionId: 'session-1', everyMinutes: 55 });
    await start($, host);
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE]);
    host.proposals.waiting = Array.from({ length: 5 }, (_, index) => ({ id: `p-${index}`, title: 'x' }));
    await host.clock.set(NOW + 24 * 60 * MINUTE);
    host.proposals.waiting = [];
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE, 'clear', WAKE]);
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE, 'clear', WAKE, WAKE]);
  });

  test("the day's clear gives the conversation a new id, and the heartbeat moves to it and keeps waking", async ($, on) => {
    // Registered first, so it answers above the fake host's catch-all command hook.
    const cleared: { host?: FakeHost } = {};
    on('command.run', { command: 'clear' }, () => {
      if (cleared.host) {
        cleared.host.sessionId = 'session-2';
        cleared.host.commands.push('clear');
      }
      return {};
    });
    const { host } = heartbeatHost(on, { sessionId: 'session-1', everyMinutes: 55 });
    cleared.host = host;
    await start($, host);
    await host.clock.advance(55 * MINUTE);
    host.proposals.waiting = Array.from({ length: 5 }, (_, index) => ({ id: `p-${index}`, title: 'x' }));
    await host.clock.set(NOW + 24 * 60 * MINUTE);
    host.proposals.waiting = [];
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE, 'clear', WAKE]);
    await host.clock.advance(55 * MINUTE);
    expect(cliCalls(host).filter((args) => args.startsWith('proposals heartbeat'))).toEqual([
      'proposals heartbeat --session=session-2 --every=55m'
    ]);
    expect(host.proposals.heartbeat?.sessionId).toBe('session-2');
    expect(host.commands).toEqual([WAKE, 'clear', WAKE, WAKE]);
  });

  test("the operator's own /clear or /resume in the heartbeat's tab moves the heartbeat with it", async ($, on) => {
    const { host } = heartbeatHost(on, { sessionId: 'session-1', everyMinutes: 55 });
    await start($, host);
    await host.clock.advance(55 * MINUTE);
    host.sessionId = 'session-3';
    await host.clock.advance(55 * MINUTE);
    expect(host.proposals.heartbeat?.sessionId).toBe('session-3');
    expect(host.commands).toEqual([WAKE, WAKE]);
    expect((await run($, 'heartbeat', 'status')).text).toStartWith('This session is the heartbeat');
  });

  test('a failed read of the proposals skips the tick and keeps the clock', async ($, on) => {
    const { host } = heartbeatHost(on, { sessionId: 'session-1', everyMinutes: 55 });
    await start($, host);
    host.failing.push('proposals list --json');
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([]);
    host.failing.length = 0;
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE]);
  });

  test('/heartbeat now wakes at once, and status says who the heartbeat is', async ($, on) => {
    const { host } = heartbeatHost(on, { sessionId: 'session-1', everyMinutes: 55 });
    expect((await run($, 'heartbeat', 'now')).text).toBe('Looking for proposals now.');
    await host.clock.settle();
    expect(host.commands).toEqual([WAKE]);
    expect((await run($, 'heartbeat', 'status')).text).toBe(
      'This session is the heartbeat, every 55m, quiet 23:00–07:00. 0 of 5 proposals waiting.'
    );
  });
});
