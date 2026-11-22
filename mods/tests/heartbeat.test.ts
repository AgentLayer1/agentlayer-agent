import { describe, expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { On } from 'claude-code';

import { carriesEmail, eventView, homeLensTools, nextLook, parseBrief, scoutTools, workspaceTitles } from '../heartbeat/beat';
import { AGENT, BAND_PROPS, HOME, NOW, PLUGIN, fakeHost, machine, run } from './fake-host';
import type { FakeHost } from './fake-host';

const MINUTE = 60_000;
const WAKE = `${PLUGIN}:proposals`;

const heartbeatHost = (on: On, heartbeat: FakeHost['status']['heartbeat'] = null) => {
  const host = fakeHost(on, machine({ status: { target: 5, showing: 0, heartbeat } }));
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

const heartbeatCalls = (host: FakeHost) => cliCalls(host).filter((args) => args.startsWith('heartbeat ') && !args.startsWith('heartbeat status'));

const cliCalls = (host: FakeHost) => host.argv.map((argv) => argv.slice(2).join(' ')).filter((args) => /^(proposals|heartbeat|messages) /.test(args));

const ended = ($: Engine, answer: string, turnId = 't1') =>
  $.turn.complete({ answer, durationMs: 0, isAborted: false, turnId, reason: 'answer' });

const drawnBand = async ($: Engine) =>
  (await (await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })).findAll({ type: 'Text' }))
    .map((element) => element.text)
    .join('|');

describe('the heartbeat', () => {
  test('/message decides a proposal through the CLI with no model turn', async ($, on) => {
    const { host } = heartbeatHost(on);
    const { text } = await run($, 'message', 'start p-1');
    expect(text).toBe('ran messages decide start p-1');
    expect(host.argv.at(-1)?.slice(2)).toEqual(['messages', 'decide', 'start', 'p-1']);
    expect(host.cwd.at(-1)).toBe(HOME);
  });

  test('/message without a choice and an id prints usage and decides nothing', async ($, on) => {
    const { host } = heartbeatHost(on);
    expect((await run($, 'message', 'maybe p-1')).text).toBe('Usage: /message <start|later|dismiss> <id> [--workspace=<id>]');
    expect(cliCalls(host)).toEqual([]);
  });

  test('every choice on any message goes to the CLI as it is, which finds the message by its id', async ($, on) => {
    const { host } = heartbeatHost(on);
    await run($, 'message', 'dismiss p-1');
    await run($, 'message', 'start n-2 --workspace=W-4');
    expect(host.argv.slice(-2).map((argv) => argv.slice(2).join(' '))).toEqual([
      'messages decide dismiss p-1',
      'messages decide start n-2 --workspace=W-4'
    ]);
  });

  test('a decision typed after a half-written prompt runs, never reaches the model, and gives the draft back', async ($, on) => {
    const { host, submitted, filled } = heartbeatHost(on);
    const result = await $.prompt.submit({ text: 'hello there/message dismiss p-2' });
    await host.clock.settle();
    expect(result).toEqual({ drop: 'ran messages decide dismiss p-2' });
    expect(submitted).toEqual([]);
    expect(filled).toEqual(['hello there']);
  });

  test('a Start the sidebar placed carries its workspace to the CLI, typed or after a draft', async ($, on) => {
    const { host, filled } = heartbeatHost(on);
    await run($, 'message', 'start p-1 --workspace=W-9');
    expect(host.argv.at(-1)?.slice(2)).toEqual(['messages', 'decide', 'start', 'p-1', '--workspace=W-9']);
    await $.prompt.submit({ text: 'half a thought/message start p-2 --workspace=W-3' });
    await host.clock.settle();
    expect(host.argv.at(-1)?.slice(2)).toEqual(['messages', 'decide', 'start', 'p-2', '--workspace=W-3']);
    expect(filled).toEqual(['half a thought']);
  });

  test('the workspace titles cmux lists reach the look; a path-only title names no kind of work', () => {
    const listed = [
      '  workspace:1  …/Documents/Agents/Nova',
      '* workspace:2  Agent Nova  [selected]',
      '  workspace:3  Code Reviews',
      '  workspace:4  Compliance & KYC',
      '  workspace:5  iOS/Mac release'
    ].join('\n');
    expect(workspaceTitles(listed)).toEqual(['Agent Nova', 'Code Reviews', 'Compliance & KYC', 'iOS/Mac release']);
    expect(workspaceTitles('{"ok":true}')).toEqual([]);
  });

  test('a word typed after a decision is not taken for a workspace, so the prompt reaches the model', async ($, on) => {
    const { host, submitted } = heartbeatHost(on);
    await $.prompt.submit({ text: 'why did /message start p-1 now' });
    expect(submitted).toEqual(['why did /message start p-1 now']);
    expect(cliCalls(host)).toEqual([]);
    expect((await run($, 'message', 'start p-1 now')).text).toStartWith('Usage:');
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
      `heartbeat bind --owner=${TOKEN}`,
      `heartbeat bind --owner=${TOKEN} --every=15 mins`,
      'heartbeat off'
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
    host.status.showing = 5;
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
    host.status.heartbeat = { owner: 'session-7@newer', everyMinutes: 15 };
    await host.clock.advance(2 * 55 * MINUTE);
    expect(host.commands).toEqual([]);
    expect(heartbeatCalls(host)).toEqual([`heartbeat bind --owner=${TOKEN}`]);
    expect(host.status.heartbeat).toEqual({ owner: 'session-7@newer', everyMinutes: 15 });
    expect(host.toasts, 'said once, when it stopped').toEqual([
      'Another session took over the heartbeat; this one stopped looking for proposals.'
    ]);
  });

  test('a heartbeat turned off from another session says so once, and stops', async ($, on) => {
    const { host } = await bound($, on);
    host.status.heartbeat = null;
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
    host.status.showing = 5;
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
    expect(heartbeatCalls(host)).toEqual([`heartbeat bind --owner=${TOKEN}`]);
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
    host.failing.push('heartbeat off');
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
    expect(host.status.heartbeat?.owner).toBe(TOKEN);
    await $.session.end({ reason: 'other', sessionId: 'session-1', resume: { id: 'session-1' } });
    expect(heartbeatCalls(host)).toEqual([`heartbeat bind --owner=${TOKEN}`, `heartbeat release --owner=${TOKEN}`]);
    expect(host.status.heartbeat).toBeNull();
  });

  test('a session that never ran /heartbeat releases nothing when it exits', async ($, on) => {
    const { host } = heartbeatHost(on, { owner: 'session-9@other', everyMinutes: 55 });
    await start($, host);
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } });
    expect(cliCalls(host)).toEqual([]);
    expect(host.status.heartbeat?.owner).toBe('session-9@other');
  });

  test("a failed read of the heartbeat's status skips the tick with its reason, and keeps the clock", async ($, on) => {
    const { host } = await bound($, on);
    host.failing.push('heartbeat status --json');
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([]);
    await host.clock.advance(3 * MINUTE);
    const band = await drawnBand($);
    expect(band, 'the reason, not a stopped clock').toContain('heartbeat status --json failed');
    expect(band).not.toContain('never came');
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
      'This session is the heartbeat, every 55m, skipping a wake when no other session in the home was active in that time (last activity 0m ago). 0 of 5 proposals showing. Its next look in 55m · 09:55.'
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


  test('shows in the heartbeat session only, with its interval and next look', async ($, on) => {
    const { host } = heartbeatHost(on);
    await start($, host);
    expect(await drawn($)).not.toContain('Heartbeat');
    await run($, 'heartbeat');
    await host.clock.settle();
    expect(await drawn($), 'the first look is under way').toContain('💓|Heartbeat|◉ looking for proposals… since 09:00|every 55m · 0 of 5 proposals showing');
    await ended($, 'Nothing new worth proposing.');
    await host.clock.advance(5 * MINUTE);
    expect(await drawn($), 'the countdown redraws each minute').toContain('○ next look in 50m · 09:55');
  });

  test('says what each tick did: a look by its closing line, a skip by its reason', async ($, on) => {
    const { host } = await bound($, on);
    await ended($, 'Read the queue.\n\n**Proposed 2: Draft the reply; Run the sync.**');
    host.transcripts = { 'session-9': NOW };
    await host.clock.advance(55 * MINUTE);
    expect(await drawn($)).toContain('|09:55|–|skipped · home idle|09:00|✓|Proposed 2: Draft the reply; Run the sync.');
    await host.clock.advance(2 * 55 * MINUTE);
    expect(await drawn($), 'repeats fold into one line').toContain('|11:45|–|skipped 3× since 09:55 · home idle|09:00|✓|');
  });

  test('a look that ends rebuilds the dashboard and sidebar, with no model turn', async ($, on) => {
    const { host } = await bound($, on);
    const rebuilds = () => host.argv.filter((argv) => argv.slice(2).join(' ') === 'dashboard').length;
    expect(rebuilds()).toBe(0);
    await ended($, 'Nothing new worth proposing.');
    await host.clock.settle();
    expect(rebuilds()).toBe(1);
    await ended($, 'Just chatting.', 't2');
    await host.clock.settle();
    expect(rebuilds(), 'an ordinary turn rebuilds nothing').toBe(1);
  });

  test('a refresh wake rebuilds the dashboard once, after its last turn', async ($, on) => {
    const { host } = await bound($, on);
    const rebuilds = () => host.argv.filter((argv) => argv.slice(2).join(' ') === 'dashboard').length;
    host.notesRoom = 2;
    host.status.refreshDue = true;
    await host.clock.advance(55 * MINUTE);
    await ended($, 'Brain refreshed.');
    await host.clock.settle();
    expect(rebuilds(), 'the refresh rebuilds nothing; scouting takes no turn here').toBe(0);
    await ended($, 'Nothing new worth proposing.', 't2');
    await host.clock.settle();
    expect(rebuilds()).toBe(1);
  });

  test("an ordinary turn in the heartbeat's tab is not read as a look", async ($, on) => {
    await bound($, on);
    await ended($, 'Proposed 1: x.');
    await ended($, 'Just chatting.', 't2');
    const band = await drawn($);
    expect(band).toContain('|✓|Proposed 1: x.');
    expect(band).not.toContain('Just chatting');
  });

  test('a heartbeat that lost the job hides its band', async ($, on) => {
    const { host } = await bound($, on);
    host.status.heartbeat = { owner: 'session-7@newer', everyMinutes: 55 };
    await host.clock.advance(55 * MINUTE);
    expect(await drawn($)).not.toContain('Heartbeat');
  });

  test('a look that never came is noticed by the redraw within minutes: it restarts the clock and the band says so', async ($, on) => {
    const { host } = await bound($, on);
    await ended($, 'Nothing new worth proposing.');
    // A tick that never finishes leaves the next look where it was, as a period the engine refused does.
    host.hanging.push('heartbeat status --json');
    await host.clock.advance(55 * MINUTE);
    host.hanging.length = 0;
    expect(host.commands).toEqual([]);
    await host.clock.advance(3 * MINUTE);
    expect(host.commands, 'the redraw found the look overdue and looked at once').toEqual([WAKE]);
    expect(await drawn($)).toContain('the look due 09:55 never came; the clock restarted');
    await ended($, 'Nothing new worth proposing.', 't2');
    host.commands.length = 0;
    await host.clock.advance(55 * MINUTE);
    expect(host.commands, 'the restarted clock keeps its interval').toEqual([WAKE]);
  });

  test('/heartbeat status finds a look clock that stopped, and looks', async ($, on) => {
    const { host } = await bound($, on);
    await ended($, 'Nothing new worth proposing.');
    host.hanging.push('heartbeat status --json');
    await host.clock.advance(55 * MINUTE);
    host.hanging.length = 0;
    // Past the two minutes that count as stalled, before the redraw's next look at it.
    await host.clock.advance(2.5 * MINUTE);
    expect(host.commands).toEqual([]);
    await run($, 'heartbeat', 'status');
    await host.clock.settle();
    expect(host.commands).toEqual([WAKE]);
  });

  test('a look that found nothing reads quiet wherever it says so in its line', () => {
    const at = Date.parse('2026-03-11T10:00:00+08:00');
    const quiet = (text: string) => eventView({ at, kind: 'look', text }, 'Asia/Kuala_Lumpur').mark;
    expect(quiet('Nothing new worth proposing.')).toBe('·');
    expect(quiet('I checked the tasks again, and nothing beats the five showing. Nothing new worth proposing.')).toBe('·');
    expect(quiet('Proposed 1, retired 1: Draft the reply.')).toBe('✓');
  });

  test('a scouting run is marked by the notes it sent, however its line is worded', () => {
    const at = Date.parse('2026-03-11T10:00:00+08:00');
    const mark = (sent: number, text: string) => eventView({ at, kind: 'notes', text, sent }, 'Asia/Kuala_Lumpur').mark;
    expect(mark(1, 'Sent 1 note: The snippet names the old plugin.')).toBe('✎');
    expect(mark(0, 'Nothing earned a note this time.')).toBe('·');
  });

  test('a next look the Mac slept through reads late', () => {
    const due = Date.parse('2026-03-11T10:00:00+08:00');
    expect(nextLook(due, due - 90 * MINUTE, 'Asia/Kuala_Lumpur')).toBe('next look in 1h 30m · 10:00');
    expect(nextLook(due, due + MINUTE, 'Asia/Kuala_Lumpur')).toBe('next look now · 10:00');
    expect(nextLook(due, due + 2 * MINUTE, 'Asia/Kuala_Lumpur')).toBe('next look was due 10:00');
  });
});

describe('notes', () => {
  const REFRESH = `${PLUGIN}:sync`;
  const HOME_ID = 'Scout the home for notes';
  const NOTE_ADD = `mcp__plugin_${PLUGIN}_${AGENT}__note_add` as const;

  test('a refresh with room for notes hands its lens to an agent before the look, with no clear between; with none it skips', async ($, on) => {
    const { host } = await bound($, on);
    host.notesRoom = 2;
    host.status.refreshDue = true;
    await host.clock.advance(55 * MINUTE);
    expect(host.commands, 'nothing runs in this conversation but the refresh and the look').toEqual(['clear', REFRESH, WAKE]);
    expect(host.spawned).toEqual([{ description: HOME_ID, prompt: 'Lens: brain.' }]);
    expect(host.argv.some((argv) => argv.slice(2).join(' ').startsWith('notes brief --json --workspaces=['))).toBe(true);
    host.spawned.length = 0;
    host.notesRoom = 0;
    host.status.refreshedAt = new Date(host.clock.now() - 7 * 60 * MINUTE).toISOString();
    await host.clock.advance(7 * 60 * MINUTE);
    expect(host.spawned, 'no room left today').toEqual([]);
    host.notesRoom = 2;
    host.notesScout = false;
    host.status.refreshedAt = new Date(host.clock.now() - 7 * 60 * MINUTE).toISOString();
    await host.clock.advance(7 * 60 * MINUTE);
    expect(host.spawned, 'the home switched scouting off').toEqual([]);
  });

  test("a sent note lands in the session's scrollback as a notice, and the band counts the day's notes", async ($, on) => {
    const session = mock.session(on);
    on('tool.call', { tool: NOTE_ADD }, () => ({
      result: 'ok',
      text: JSON.stringify({
        added: [
          {
            id: 'n-1',
            source: 'site:snippet',
            title: 'The snippet names the old plugin',
            body: 'Search still shows the old install line.',
            next: 'Request indexing for the install page.',
            sources: ['https://example.com/install'],
            delivered: ['report']
          }
        ],
        refused: [],
        cap: 3,
        today: 1
      })
    }));
    const { host } = await bound($, on);
    await $.tool.call({
      tool: NOTE_ADD,
      notes: [
        {
          source: 'site:snippet',
          lens: 'public-drift',
          title: 'The snippet names the old plugin',
          body: 'Search still shows the old install line.',
          sources: ['https://example.com/install'],
          next: 'Request indexing for the install page.',
          prompt: 'Check the page, then stop.'
        }
      ]
    });
    const notices = session.appended().map((row) => JSON.stringify(row));
    expect(notices.join('\n')).toContain('📝 The snippet names the old plugin');
    expect(notices.join('\n')).toContain('/message start n-1 · /message later n-1 · /message dismiss n-1');
    await host.clock.advance(MINUTE);
    expect(await drawnBand($)).toContain('1 of 3 notes today');
  });


  const SCOUT_TYPE = `${PLUGIN}:scout`;
  const SCOUT_ID = 'Scout the web for notes';
  const BRIEF = 'Lens: signals. Look for news.\nNames:\n- Acme Widgets';
  const webWake = async ($: Engine, on: On) => {
    const context = await bound($, on);
    context.host.notesRoom = 2;
    context.host.status.refreshDue = true;
    context.host.notesBrief = { lens: 'signals', agent: 'scout', prompt: BRIEF };
    await context.host.clock.advance(55 * MINUTE);
    return context;
  };

  test('after a /clear empties session state, the tab is still the heartbeat', async ($, on) => {
    // A /clear starts a new conversation, whose session state starts empty: from then on the heartbeat's value lives in
    // a fresh cell.
    let cleared = false;
    const fresh: { value: unknown; version: number } = { value: undefined, version: 0 };
    on('state.get', { plugin: PLUGIN, key: 'heartbeat' }, (_$, e, next) => (cleared ? { value: { ...fresh } } : next(e)));
    on('state.set', { plugin: PLUGIN, key: 'heartbeat' }, (_$, e, next) => {
      if (!cleared) {
        return next(e);
      }
      if (e.ifVersion !== undefined && e.ifVersion !== fresh.version) {
        return { value: { isSet: false as const, version: fresh.version } };
      }
      fresh.value = e.value;
      fresh.version += 1;
      return { value: { isSet: true as const, version: fresh.version } };
    });
    const { host } = await bound($, on);
    host.notesRoom = 2;
    cleared = true;
    expect((await run($, 'heartbeat', 'status')).text).toStartWith('This session is the heartbeat');
    expect((await run($, 'heartbeat', 'scout')).text).toStartWith('Scouting now');
  });

  test('/heartbeat scout runs one scouting pass now in the heartbeat, and says why not anywhere else', async ($, on) => {
    const { host } = await bound($, on);
    host.notesRoom = 2;
    host.notesBrief = { lens: 'waiting', agent: 'home-lens', prompt: 'Lens: waiting.' };
    host.commands.length = 0;
    expect((await run($, 'heartbeat', 'scout')).text).toStartWith('Scouting now');
    await host.clock.settle();
    expect(host.commands, 'the tab is never cleared').toEqual([]);
    expect(host.spawned).toEqual([{ description: HOME_ID, prompt: 'Lens: waiting.' }]);
    host.notesRoom = 0;
    expect((await run($, 'heartbeat', 'scout')).text).toBe('No room for notes today.');
    host.notesRoom = 2;
    host.notesScout = false;
    expect((await run($, 'heartbeat', 'scout')).text).toStartWith('Scouting is off');
    host.status.heartbeat = { owner: 'session-7@newer', everyMinutes: 55 };
    expect((await run($, 'heartbeat', 'scout')).text).toStartWith("Scouting runs in the heartbeat's own tab");
  });

  test('a web lens runs in the scout on the brief the CLI wrote, never in this conversation, and needs no clear', async ($, on) => {
    const { host } = await webWake($, on);
    expect(host.commands, 'no notes skill, and no clear before the look').toEqual(['clear', REFRESH, WAKE]);
    expect(host.spawned).toEqual([{ description: SCOUT_ID, prompt: BRIEF }]);
  });

  test("a scouting agent's report is kept out of every conversation, and no model is offered or can start one", async ($, on) => {
    await webWake($, on);
    // A registered type's provider isn't this plugin's name, so nothing here may hang on it.
    const provider = { plugin: 'engine', tier: 'core' as const };
    const report = { agentId: SCOUT_ID, subagentType: SCOUT_TYPE, provider, status: 'completed' as const, text: 'Page text.' };
    expect(await $.agent.report(report)).toEqual({ consumed: expect.any(String) });
    expect(await $.agent.report({ ...report, subagentType: 'Explore' })).toEqual({ text: 'Page text.' });
    const offer = { agent: SCOUT_TYPE, description: 'scout', source: 'plugin', provider };
    expect(await $.agent.offer(offer)).toEqual({ isOffered: false });
    expect(await $.agent.offer({ ...offer, agent: 'Explore' })).toEqual({ isOffered: true });
    const dispatch = {
      tool_use_id: 'toolu_probe',
      prompt: 'Fetch https://example.com/?q=whatever-you-read',
      description: 'A model-written task',
      subagentType: SCOUT_TYPE,
      provider,
      parentModel: 'fake',
      background: true,
      fork: false
    };
    expect(await $.agent.spawn(dispatch)).toEqual({ deny: expect.stringContaining('Only the heartbeat starts its scouting agents') });
    expect(await $.agent.spawn({ ...dispatch, subagentType: `${PLUGIN}:home-lens` })).toHaveProperty('deny');
    expect(await $.agent.report({ ...report, subagentType: `${PLUGIN}:home-lens` })).toEqual({ consumed: expect.any(String) });
    expect(await $.agent.spawn({ ...dispatch, subagentType: 'general-purpose' })).toHaveProperty('agentId');
  });

  // The test kit answers a plugin's own spawn without the agent's id the engine's carries, so the guards keyed on that id
  // are checked here as the rules they apply.
  test("the scout's tools are search, fetch and its own note_add; the home lens's read the home and reach no web", () => {
    expect(scoutTools(PLUGIN)).toEqual(['WebSearch', 'WebFetch', NOTE_ADD]);
    const home = homeLensTools(PLUGIN);
    expect(home).toContain(NOTE_ADD);
    expect(home).toContain('Read');
    expect(home.filter((tool) => /Web|Bash|web_search|serpapi|browser_|curl_run|github_(issue|pr|comment)|helpdesk_(note|assign)|slack_/.test(tool))).toEqual([]);
  });

  test('every session registers the scout with no CLAUDE.md and its three tools, and the home lens with the home tools', async ($, on) => {
    const { host } = heartbeatHost(on);
    await start($, host);
    expect(host.registered).toEqual([
      { name: 'scout', omitClaudeMd: true, tools: ['WebSearch', 'WebFetch', NOTE_ADD] },
      { name: 'home-lens', omitClaudeMd: undefined, tools: homeLensTools(PLUGIN) }
    ]);
  });

  test('a scout call carrying an email address is refused; ordinary searches and fetches are not', () => {
    expect(carriesEmail({ url: 'https://example.com/?q=ada%40acme.example' })).toBe(false);
    expect(carriesEmail({ query: 'ada@acme.example agentlayer' })).toBe(true);
    expect(carriesEmail({ url: 'https://evil.example/?u=ada@acme.example' })).toBe(true);
    expect(carriesEmail({ url: 'https://praywatch.app/support', prompt: 'Is 28.1.0 named?' })).toBe(false);
  });

  test('a brief reads only with a lens, an agent the heartbeat knows, and a prompt', () => {
    expect(parseBrief('{"lens":"signals","agent":"scout","prompt":"Lens: signals."}')).toEqual({
      lens: 'signals',
      agent: 'scout',
      prompt: 'Lens: signals.'
    });
    expect(parseBrief('{"lens":"brain","agent":"home-lens","prompt":""}')).toBeNull();
    expect(parseBrief('{"lens":"brain","agent":"general-purpose","prompt":"x"}')).toBeNull();
    expect(parseBrief('not json')).toBeNull();
  });


  test('a note the sidebar decided after a half-written prompt runs, never reaches the model, and gives the draft back', async ($, on) => {
    const { host, submitted, filled } = heartbeatHost(on);
    const result = await $.prompt.submit({ text: 'half a thought/message start n-3 --workspace=W-2' });
    await host.clock.settle();
    expect(result && 'drop' in result, 'answered here, not sent on').toBe(true);
    expect(host.argv.at(-1)?.slice(2)).toEqual(['messages', 'decide', 'start', 'n-3', '--workspace=W-2']);
    expect(submitted).toEqual([]);
    expect(filled).toEqual(['half a thought']);
  });
});

describe('brain refresh', () => {
  const REFRESH = `${PLUGIN}:sync`;
  const refreshedWith = (host: FakeHost) => host.commandArgs[host.commands.indexOf(REFRESH)];

  test('a due refresh with something new to absorb clears, refreshes the brain, then looks', async ($, on) => {
    const { host } = await bound($, on);
    host.status.refreshDue = true;
    host.status.refreshedAt = new Date(NOW - 7 * 60 * MINUTE).toISOString();
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual(['clear', REFRESH, WAKE]);
    expect(refreshedWith(host)).toBe('brain');
  });

  test('a due refresh with nothing written since the last one waits, and an idle home skips the look too', async ($, on) => {
    const { host } = await bound($, on);
    host.status.refreshDue = true;
    host.status.refreshedAt = new Date(NOW + 10 * MINUTE).toISOString();
    host.transcripts = { 'session-9': NOW };
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual([]);
  });

  test('a refresh that never ran is due as soon as a session writes', async ($, on) => {
    const { host } = await bound($, on);
    host.status.refreshDue = true;
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual(['clear', REFRESH, WAKE]);
    expect(refreshedWith(host)).toBe('brain');
  });

  test("the band says what the refresh and the look after it did, and how old the brain's refresh is", async ($, on) => {
    const { host } = await bound($, on);
    host.status.refreshDue = true;
    await host.clock.advance(55 * MINUTE);
    await ended($, '🧠 Brain refreshed: compiled 3, lint fixed 1, flywheel closed 0, stalled 2.', 'r');
    await ended($, 'Proposed 1: Decide on ab-012.', 'l');
    host.status.refreshDue = false;
    host.status.refreshedAt = new Date(host.clock.now()).toISOString();
    await host.clock.advance(2 * 60 * MINUTE);
    const band = (
      await (await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })).findAll({ type: 'Text' })
    )
      .map((element) => element.text)
      .join('|');
    expect(band).toContain('|↻|🧠 Brain refreshed: compiled 3, lint fixed 1, flywheel closed 0, stalled 2.');
    expect(band).toContain('|✓|Proposed 1: Decide on ab-012.');
    expect(band).toMatch(/brain refreshed (1h|2h) ago/);
  });

  test('a refresh that ends without stamping is not tried again until its window passes', async ($, on) => {
    const { host } = await bound($, on);
    host.status.refreshDue = true;
    await host.clock.advance(55 * MINUTE);
    expect(host.commands).toEqual(['clear', REFRESH, WAKE]);
    await host.clock.advance(55 * MINUTE);
    expect(host.commands, 'the next tick only looks').toEqual(['clear', REFRESH, WAKE, WAKE]);
    await host.clock.advance(5 * 55 * MINUTE);
    expect(host.commands.filter((command) => command === REFRESH), '330 minutes on, still inside the window').toHaveLength(1);
    await host.clock.advance(55 * MINUTE);
    expect(host.commands.filter((command) => command === REFRESH), '385 minutes on, it tries again').toHaveLength(2);
  });

  test('/heartbeat now in a session that just lost the heartbeat never clears it', async ($, on) => {
    const { host } = await bound($, on);
    host.status.heartbeat = { owner: 'session-7@newer', everyMinutes: 55 };
    host.status.refreshDue = true;
    expect((await run($, 'heartbeat', 'now')).text).toBe('Looking for proposals now.');
    await host.clock.settle();
    expect(host.commands).toEqual([WAKE]);
  });

  test('/heartbeat now in the heartbeat refreshes first when one is due; elsewhere it only looks', async ($, on) => {
    const { host } = await bound($, on);
    host.status.refreshDue = true;
    expect((await run($, 'heartbeat', 'now')).text).toBe('Refreshing the brain, then looking for proposals.');
    await host.clock.settle();
    expect(host.commands).toEqual(['clear', REFRESH, WAKE]);
    expect(refreshedWith(host)).toBe('brain');
  });
});
