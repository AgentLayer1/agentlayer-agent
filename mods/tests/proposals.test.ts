import { describe, expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On } from 'claude-code';

import { nextLook } from '../proposals/beat';
import { BAND_PROPS, HOME, NOW, PLUGIN, fakeHost, machine, run } from './fake-host';
import type { FakeHost } from './fake-host';

const MINUTE = 60_000;
const WAKE = `${PLUGIN}:proposals`;

const heartbeatHost = (on: On, heartbeat: FakeHost['proposals']['heartbeat'] = null) => {
  const host = fakeHost(on, machine({ proposals: { target: 5, showing: [], heartbeat } }));
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

// The token /heartbeat binds with: the conversation id and the clock when it was first chosen.
const TOKEN = `session-1@${NOW.toString(36)}`;

// A session that ran /heartbeat, so it is the heartbeat from the clock's current time; the look it takes at once is
// left out of what the test then counts.
const bound = async ($: Engine, on: On, every = '') => {
  const context = heartbeatHost(on);
  await start($, context.host);
  await run($, 'heartbeat', every);
  await context.host.clock.settle();
  context.host.commands.length = 0;
  context.host.commandArgs.length = 0;
  return context;
};

const heartbeatCalls = (host: FakeHost) => cliCalls(host).filter((args) => args.startsWith('proposals heartbeat'));

const cliCalls = (host: FakeHost) => host.argv.map((argv) => argv.slice(2).join(' ')).filter((args) => args.startsWith('proposals '));

describe('proposals', () => {
  test('/proposal runs the decision through the CLI with no model turn', async ($, on) => {
    const { host } = heartbeatHost(on);
    const { text } = await run($, 'proposal', 'start p-1');
    expect(text).toBe('ran proposals decide start p-1');
    expect(host.argv.at(-1)?.slice(2)).toEqual(['proposals', 'decide', 'start', 'p-1']);
    expect(host.cwd.at(-1)).toBe(HOME);
  });

  test('/proposal without a choice and an id prints usage and decides nothing', async ($, on) => {
    const { host } = heartbeatHost(on);
    expect((await run($, 'proposal', 'maybe p-1')).text).toBe('Usage: /proposal <start|later|skip> <id>');
    expect(cliCalls(host)).toEqual([]);
  });

  test('a decision typed after a half-written prompt runs, never reaches the model, and gives the draft back', async ($, on) => {
    const { host, submitted, filled } = heartbeatHost(on);
    const result = await $.prompt.submit({ text: 'hello there/proposal skip p-2' });
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

  test('/heartbeat makes this session the heartbeat by its token, at an interval when one is given', async ($, on) => {
    const { host } = heartbeatHost(on);
    await run($, 'heartbeat');
    await run($, 'heartbeat', '15 mins');
    await run($, 'heartbeat', 'off');
    expect(heartbeatCalls(host)).toEqual([
      `proposals heartbeat --owner=${TOKEN}`,
      `proposals heartbeat --owner=${TOKEN} --every=15 mins`,
      'proposals heartbeat --off'
    ]);
  });

  test('a session that never ran /heartbeat starts without reading the proposals', async ($, on) => {
    const { host } = heartbeatHost(on, { owner: 'session-9@other', everyMinutes: 55 });
    await start($, host);
    expect(cliCalls(host)).toEqual([]);
  });

  test('/heartbeat looks for proposals at once, then on its interval, at any hour', async ($, on) => {
    const { host } = heartbeatHost(on);
    await host.clock.set(Date.parse('2026-03-11T02:10:00+08:00'));
    await start($, host);
    expect((await run($, 'heartbeat')).text).toEndWith(' Looking for proposals now.');
    await host.clock.settle();
    expect(host.commands).toEqual([WAKE]);
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE, WAKE]);
  });

  test('/heartbeat with proposals already full still looks, since a better one can replace a card', async ($, on) => {
    const { host } = heartbeatHost(on);
    host.proposals.room = 0;
    await start($, host);
    expect((await run($, 'heartbeat')).text).toEndWith(' Looking for proposals now.');
    await host.clock.settle();
    expect(host.commands).toEqual([WAKE]);
  });

  test('the heartbeat wakes on its interval when the session is idle and proposals are short', async ($, on) => {
    const { host } = await bound($, on);
    await host.clock.advance(54 * MINUTE);
    expect(host.commands).toEqual([]);
    await host.clock.advance(MINUTE);
    expect(host.commands).toEqual([WAKE]);
  });

  test('a new interval replaces the old clock rather than adding one', async ($, on) => {
    const { host } = await bound($, on);
    await run($, 'heartbeat', '15m');
    await host.clock.settle();
    host.commands.length = 0;
    await host.clock.advance(55 * MINUTE);
    expect(host.commands, 'three 15-minute wakes; a leftover 55-minute clock would add a fourth').toEqual([WAKE, WAKE, WAKE]);
  });

  test('a heartbeat bound by another process costs this one nothing, even one named by this conversation id', async ($, on) => {
    const { host } = heartbeatHost(on, { owner: 'session-1', everyMinutes: 55 });
    await start($, host);
    await host.clock.advance(3 * 55 * MINUTE);
    expect(host.commands).toEqual([]);
    expect(host.toasts, 'it never held the heartbeat, so it has nothing to say').toEqual([]);
    expect((await run($, 'heartbeat', 'status')).text).toStartWith('Another session is the heartbeat');
  });

  test('a newer session that takes the heartbeat over keeps it', async ($, on) => {
    const { host } = await bound($, on);
    host.sessionId = 'session-2';
    host.proposals.heartbeat = { owner: 'session-7@newer', everyMinutes: 15 };
    await host.clock.advance(2 * 55 * MINUTE);
    expect(host.commands).toEqual([]);
    expect(heartbeatCalls(host)).toEqual([`proposals heartbeat --owner=${TOKEN}`]);
    expect(host.proposals.heartbeat).toEqual({ owner: 'session-7@newer', everyMinutes: 15 });
    expect(host.toasts, 'said once, when it stopped').toEqual([
      'Another session took over the heartbeat; this one stopped looking for proposals.'
    ]);
  });

  test('a heartbeat turned off from another session says so once, and stops', async ($, on) => {
    const { host } = await bound($, on);
    host.proposals.heartbeat = null;
    await host.clock.advance(3 * 55 * MINUTE);
    expect(host.commands).toEqual([]);
    expect(host.toasts).toEqual(['The heartbeat was turned off; this session stopped looking for proposals.']);
  });

  test('a running turn holds the wake; full proposals do not', async ($, on) => {
    const { host } = await bound($, on);
    await $.turn.start({ text: '', turnId: 't1' });
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([]);
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' });
    host.proposals.showing = Array.from({ length: 5 }, (_, index) => ({ id: `p-${index}`, title: 'x' }));
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE]);
  });

  test('/heartbeat with an interval looks at once, then waits that full interval', async ($, on) => {
    const { host } = heartbeatHost(on);
    await start($, host);
    await run($, 'heartbeat', '15m');
    await host.clock.settle();
    expect(host.commands).toEqual([WAKE]);
    await host.clock.advance(14 * MINUTE);
    expect(host.commands).toEqual([WAKE]);
    await host.clock.advance(MINUTE);
    expect(host.commands).toEqual([WAKE, WAKE]);
  });

  test('a wake skips when no other session in the home wrote in the interval, and the next one after one does wakes', async ($, on) => {
    const { host } = await bound($, on);
    host.transcripts = { 'session-9': NOW };
    await host.clock.advance(55 * MINUTE);
    expect(host.commands, 'its own transcript, written just now, is not another session').toEqual([]);
    await host.clock.advance(20 * MINUTE);
    host.transcripts = { 'session-9': host.clock.now() };
    await host.clock.advance(35 * MINUTE);
    expect(host.commands).toEqual([WAKE]);
  });

  test('a home with no other session skips every wake, though the bind still looked', async ($, on) => {
    const { host } = heartbeatHost(on);
    host.transcripts = {};
    await start($, host);
    await run($, 'heartbeat');
    await host.clock.settle();
    await host.clock.advance(3 * 55 * MINUTE);
    expect(host.commands).toEqual([WAKE]);
  });

  test('a session that keeps no transcript wakes on its interval, since it cannot tell', async ($, on) => {
    const { host } = await bound($, on);
    host.transcriptPath = '';
    host.transcripts = {};
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE]);
  });

  test("the transcript the day's clear left behind is not read as another session", async ($, on) => {
    const cleared: { host?: FakeHost } = {};
    on('command.run', { command: 'clear' }, () => {
      if (cleared.host) {
        cleared.host.sessionId = 'session-2';
        cleared.host.transcripts = { 'session-1': cleared.host.clock.now() + MINUTE };
        cleared.host.commands.push('clear');
      }
      return {};
    });
    const { host } = await bound($, on);
    cleared.host = host;
    host.transcripts = {};
    await host.clock.set(NOW + 24 * 60 * MINUTE);
    host.transcripts = { 'session-9': host.clock.now() };
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual(['clear', WAKE]);
    await host.clock.advance(55 * MINUTE);
    expect(host.commands, 'session-1 was the heartbeat before its clear').toEqual(['clear', WAKE]);
  });

  test("the day's first wake clears the conversation first", async ($, on) => {
    const { host } = await bound($, on);
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE]);
    // An idle home holds the ticks the jump to tomorrow fires; a session written to just now wakes the next one.
    host.transcripts = { 'session-9': NOW };
    await host.clock.set(NOW + 24 * 60 * MINUTE);
    delete host.transcripts;
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE, 'clear', WAKE]);
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE, 'clear', WAKE, WAKE]);
  });

  test("the day's clear gives the conversation a new id, and the heartbeat keeps waking without binding again", async ($, on) => {
    // Registered first, so it answers above the fake host's catch-all command hook.
    const cleared: { host?: FakeHost } = {};
    on('command.run', { command: 'clear' }, () => {
      if (cleared.host) {
        cleared.host.sessionId = 'session-2';
        cleared.host.commands.push('clear');
      }
      return {};
    });
    const { host } = await bound($, on);
    cleared.host = host;
    await host.clock.advance(55 * MINUTE);
    // An idle home holds the ticks the jump to tomorrow fires; a session written to just now wakes the next one.
    host.transcripts = { 'session-9': NOW };
    await host.clock.set(NOW + 24 * 60 * MINUTE);
    delete host.transcripts;
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE, 'clear', WAKE]);
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE, 'clear', WAKE, WAKE]);
    expect(heartbeatCalls(host)).toEqual([`proposals heartbeat --owner=${TOKEN}`]);
  });

  test("the operator's own /clear or /resume in the heartbeat's tab keeps it the heartbeat", async ($, on) => {
    const { host } = await bound($, on);
    await host.clock.advance(55 * MINUTE);
    host.sessionId = 'session-3';
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE, WAKE]);
    expect((await run($, 'heartbeat', 'status')).text).toStartWith('This session is the heartbeat');
  });

  test('a /heartbeat off that fails after a /clear leaves the heartbeat running', async ($, on) => {
    const { host } = await bound($, on);
    host.sessionId = 'session-2';
    host.failing.push('proposals heartbeat --off');
    expect((await run($, 'heartbeat', 'off')).text).toContain('failed');
    await host.clock.advance(2 * 55 * MINUTE);
    expect(host.commands).toEqual([WAKE, WAKE]);
    host.failing.length = 0;
    await run($, 'heartbeat', 'off');
    await host.clock.advance(2 * 55 * MINUTE);
    expect(host.commands).toEqual([WAKE, WAKE]);
  });

  test('leaving the heartbeat session gives the heartbeat up; a /clear or a /resume keeps it', async ($, on) => {
    const { host } = await bound($, on);
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } });
    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-1' } });
    expect(host.proposals.heartbeat?.owner).toBe(TOKEN);
    await $.session.end({ reason: 'other', sessionId: 'session-1', resume: { id: 'session-1' } });
    expect(heartbeatCalls(host)).toEqual([`proposals heartbeat --owner=${TOKEN}`, `proposals heartbeat --release --owner=${TOKEN}`]);
    expect(host.proposals.heartbeat).toBeNull();
  });

  test('a session that never ran /heartbeat releases nothing when it exits', async ($, on) => {
    const { host } = heartbeatHost(on, { owner: 'session-9@other', everyMinutes: 55 });
    await start($, host);
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } });
    expect(cliCalls(host)).toEqual([]);
    expect(host.proposals.heartbeat?.owner).toBe('session-9@other');
  });

  test('a failed read of the proposals skips the tick and keeps the clock', async ($, on) => {
    const { host } = await bound($, on);
    host.failing.push('proposals list --json');
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([]);
    host.failing.length = 0;
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([WAKE]);
  });

  test('/heartbeat now in an ordinary session refills on any day and never clears it', async ($, on) => {
    const { host } = heartbeatHost(on);
    await run($, 'heartbeat', 'now');
    await host.clock.settle();
    await host.clock.set(NOW + 24 * 60 * MINUTE);
    await run($, 'heartbeat', 'now');
    await host.clock.settle();
    expect(host.commands).toEqual([WAKE, WAKE]);
  });

  test('/heartbeat now wakes at once, and status says who the heartbeat is', async ($, on) => {
    const { host } = await bound($, on);
    expect((await run($, 'heartbeat', 'now')).text).toBe('Looking for proposals now.');
    await host.clock.settle();
    expect(host.commands).toEqual([WAKE]);
    expect((await run($, 'heartbeat', 'status')).text).toBe(
      'This session is the heartbeat, every 55m, skipping a wake when no other session in the home was active in that time (last activity 0m ago). 0 of 5 proposals showing. Its next look 09:55.'
    );
  });
});

describe('heartbeat band', () => {
  const drawn = async ($: Engine) =>
    (
      await (await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })).findAll({
        type: 'Text'
      })
    )
      .map((element) => element.text)
      .join('|');

  const ended = ($: Engine, answer: string, turnId = 't1') =>
    $.turn.complete({ answer, durationMs: 0, isAborted: false, turnId, reason: 'answer' });

  test('shows in the heartbeat session only, with its interval and next look', async ($, on) => {
    const { host } = heartbeatHost(on);
    await start($, host);
    expect(await drawn($)).not.toContain('Heartbeat');
    await run($, 'heartbeat');
    await host.clock.settle();
    const band = await drawn($);
    expect(band).toContain('💓|Heartbeat|every 55m · next look ');
    expect(band).toContain(' · 0 of 5 showing');
  });

  test('says what each tick did: a look by its closing line, a skip by its reason', async ($, on) => {
    const { host } = await bound($, on);
    await ended($, 'Read the queue.\n\n**Proposed 2: Draft the reply; Run the sync.**');
    host.transcripts = { 'session-9': NOW };
    await host.clock.advance(55 * MINUTE);
    const band = await drawn($);
    expect(band).toContain('skipped: home idle');
    expect(band).toContain('looked: Proposed 2: Draft the reply; Run the sync.');
    expect(band.indexOf('skipped: home idle'), 'newest first').toBeLessThan(band.indexOf('looked:'));
  });

  test("an ordinary turn in the heartbeat's tab is not read as a look", async ($, on) => {
    await bound($, on);
    await ended($, 'Proposed 1: x.');
    await ended($, 'Just chatting.', 't2');
    const band = await drawn($);
    expect(band).toContain('looked: Proposed 1: x.');
    expect(band).not.toContain('Just chatting');
  });

  test('a heartbeat that lost the job hides its band', async ($, on) => {
    const { host } = await bound($, on);
    host.proposals.heartbeat = { owner: 'session-7@newer', everyMinutes: 55 };
    await host.clock.advance(55 * MINUTE);
    expect(await drawn($)).not.toContain('Heartbeat');
  });

  test('a next look the Mac slept through reads late', () => {
    const due = Date.parse('2026-03-11T10:00:00+08:00');
    expect(nextLook(due, due + MINUTE, 'Asia/Kuala_Lumpur')).toBe('next look 10:00');
    expect(nextLook(due, due + 2 * MINUTE, 'Asia/Kuala_Lumpur')).toBe('next look 10:00 (late)');
  });
});

describe('brain refresh', () => {
  const REFRESH = `${PLUGIN}:sync`;
  const refreshedWith = (host: FakeHost) => host.commandArgs[host.commands.indexOf(REFRESH)];

  test('a due refresh with something new to absorb clears, refreshes the brain, then looks', async ($, on) => {
    const { host } = await bound($, on);
    host.proposals.refreshDue = true;
    host.proposals.refreshedAt = new Date(NOW - 7 * 60 * MINUTE).toISOString();
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual(['clear', REFRESH, WAKE]);
    expect(refreshedWith(host)).toBe('brain');
  });

  test('a due refresh with nothing written since the last one waits, and an idle home skips the look too', async ($, on) => {
    const { host } = await bound($, on);
    host.proposals.refreshDue = true;
    host.proposals.refreshedAt = new Date(NOW + 10 * MINUTE).toISOString();
    host.transcripts = { 'session-9': NOW };
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([]);
  });

  test('a refresh that never ran is due as soon as a session writes', async ($, on) => {
    const { host } = await bound($, on);
    host.proposals.refreshDue = true;
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual(['clear', REFRESH, WAKE]);
    expect(refreshedWith(host)).toBe('brain');
  });

  test("the band says what the refresh and the look after it did, and how old the brain's refresh is", async ($, on) => {
    const { host } = await bound($, on);
    host.proposals.refreshDue = true;
    await host.clock.advance(55 * MINUTE);
    const finish = (answer: string, turnId: string) =>
      $.turn.complete({ answer, durationMs: 0, isAborted: false, turnId, reason: 'answer' });
    await finish('🧠 Brain refreshed: compiled 3, lint fixed 1, flywheel closed 0, stalled 2.', 'r');
    await finish('Proposed 1: Decide on ab-012.', 'l');
    host.proposals.refreshDue = false;
    host.proposals.refreshedAt = new Date(host.clock.now()).toISOString();
    await host.clock.advance(2 * 60 * MINUTE);
    const band = (
      await (await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })).findAll({ type: 'Text' })
    )
      .map((element) => element.text)
      .join('|');
    expect(band).toContain('refreshed: 🧠 Brain refreshed: compiled 3, lint fixed 1, flywheel closed 0, stalled 2.');
    expect(band).toContain('looked: Proposed 1: Decide on ab-012.');
    expect(band).toMatch(/brain refreshed (1h|2h) ago/);
  });

  test('/heartbeat now in the heartbeat refreshes first when one is due; elsewhere it only looks', async ($, on) => {
    const { host } = await bound($, on);
    host.proposals.refreshDue = true;
    expect((await run($, 'heartbeat', 'now')).text).toBe('Refreshing the brain, then looking for proposals.');
    await host.clock.settle();
    expect(host.commands).toEqual(['clear', REFRESH, WAKE]);
    expect(refreshedWith(host)).toBe('brain');
  });
});
