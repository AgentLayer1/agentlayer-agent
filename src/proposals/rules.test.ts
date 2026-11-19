import { expect, test } from 'bun:test';
import { TIMEZONE } from '@/config';
import { EMPTY_LEDGER, parseLedger, type ProposalLedger } from './ledger';
import {
  addProposals,
  BACKLOG,
  decide,
  nextMorning,
  parseEvery,
  proposalCards,
  type ProposalInput,
  removeProposals,
  roomFor,
  waitingNow
} from './rules';

const NOW = new Date('2026-11-20T10:00:00+08:00');

const input = (source: string, title = `Do ${source}`): ProposalInput => ({
  source,
  title,
  trigger: 'Something happened',
  quote: '',
  detail: 'It does the thing and stops.',
  reach: 'Drafts only.',
  estimate: '5m',
  due: '',
  prompt: `Secret prompt for ${source}`
});

const counter = () => {
  let next = 0;
  return () => `p-${(next++).toString(36)}`;
};

const withTwo = (): ProposalLedger =>
  addProposals(EMPTY_LEDGER, [input('task:aa-001'), input('sync')], NOW, counter()).ledger;

test('adds proposals in order, waiting, with ids of their own', () => {
  const { added, refused } = addProposals(EMPTY_LEDGER, [input('task:aa-001'), input('sync')], NOW, counter());
  expect(added.map(({ id, source, state }) => [id, source, state])).toEqual([
    ['p-0', 'task:aa-001', 'waiting'],
    ['p-1', 'sync', 'waiting']
  ]);
  expect(refused).toEqual([]);
});

test('refuses a source that is already proposed, even twice in one call', () => {
  const { added, refused } = addProposals(withTwo(), [input('sync'), input('gh:acme/app#7'), input('gh:acme/app#7')], NOW);
  expect(added.map(({ source }) => source)).toEqual(['gh:acme/app#7']);
  expect(refused.map(({ source, reason }) => [source, reason])).toEqual([
    ['sync', 'already proposed'],
    ['gh:acme/app#7', 'already proposed']
  ]);
});

test('a started source rests a day and a skipped one a week', () => {
  const started = decide(withTwo(), 'p-0', 'start', NOW);
  const skipped = started.outcome === 'decided' ? decide(started.ledger, 'p-1', 'skip', NOW) : started;
  if (skipped.outcome !== 'decided') {
    throw new Error('expected both decisions to land');
  }
  const again = [input('task:aa-001'), input('sync')];
  const nextDay = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
  const nextWeek = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);
  expect(addProposals(skipped.ledger, again, NOW).refused.map(({ reason }) => reason)).toEqual([
    'started in the last day',
    'skipped in the last week'
  ]);
  expect(addProposals(skipped.ledger, again, nextDay).refused.map(({ reason }) => reason)).toEqual([
    'skipped in the last week'
  ]);
  expect(addProposals(skipped.ledger, again, nextWeek).refused).toEqual([]);
});

test(`refuses past ${BACKLOG} waiting`, () => {
  const many = Array.from({ length: BACKLOG + 2 }, (_, index) => input(`task:aa-${index}`));
  const { added, refused } = addProposals(EMPTY_LEDGER, many, NOW);
  expect(added).toHaveLength(BACKLOG);
  expect(refused.map(({ reason }) => reason)).toEqual([`${BACKLOG} are already waiting`, `${BACKLOG} are already waiting`]);
});

test('room is what fills five, and none once put-off proposals fill the backlog', () => {
  expect(roomFor(withTwo(), NOW)).toBe(3);
  const many = Array.from({ length: BACKLOG }, (_, index) => input(`task:aa-${index}`));
  const full = addProposals(EMPTY_LEDGER, many, NOW, counter()).ledger;
  const putOff = full.proposals.reduce((ledger, { id }) => {
    const later = decide(ledger, id, 'later', NOW);
    return later.outcome === 'decided' ? later.ledger : ledger;
  }, full);
  expect(waitingNow(putOff, NOW)).toEqual([]);
  expect(roomFor(putOff, NOW)).toBe(0);
});

test('a proposal is decided once, so a second Start changes nothing', () => {
  const first = decide(withTwo(), 'p-0', 'start', NOW);
  expect(first.outcome).toBe('decided');
  const second = first.outcome === 'decided' ? decide(first.ledger, 'p-0', 'start', NOW) : first;
  expect(second.outcome).toBe('already');
  expect(decide(withTwo(), 'p-9', 'start', NOW).outcome).toBe('unknown');
});

test('Later puts a proposal off until the next 08:00 in the home timezone', () => {
  const localTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TIMEZONE, hourCycle: 'h23' });
  const instants = ['2026-11-20T00:30:00Z', '2026-11-20T07:59:00Z', '2026-11-20T12:00:00Z', '2026-11-20T23:30:00Z'];
  instants.forEach((iso) => {
    const now = new Date(iso);
    const morning = nextMorning(now);
    expect(localTime(morning)).toBe('08:00:00');
    expect(Date.parse(morning)).toBeGreaterThan(now.getTime());
    // 25 hours on a day the clocks go back.
    expect(Date.parse(morning) - now.getTime()).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
  });
  const later = decide(withTwo(), 'p-0', 'later', NOW);
  if (later.outcome !== 'decided') {
    throw new Error('expected Later to land');
  }
  expect(waitingNow(later.ledger, NOW).map(({ id }) => id)).toEqual(['p-1']);
  const back = new Date(Date.parse(later.proposal.laterUntil));
  expect(waitingNow(later.ledger, back).map(({ id }) => id)).toEqual(['p-0', 'p-1']);
});

test('what a surface is given never carries a prompt or a source', () => {
  const cards = proposalCards(withTwo());
  expect(cards).toHaveLength(2);
  expect(JSON.stringify(cards)).not.toContain('Secret prompt');
  expect(cards.every((card) => !('source' in card) && !('prompt' in card))).toBe(true);
});

test('remove takes proposals out by id', () => {
  expect(removeProposals(withTwo(), ['p-0']).proposals.map(({ id }) => id)).toEqual(['p-1']);
});

test('intervals read as minutes, within 5 minutes and a day', () => {
  expect(['15m', '15 mins', '1h', '2 hours', '90 minutes'].map(parseEvery)).toEqual([15, 15, 60, 120, 90]);
  expect(parseEvery('2m')).toBeInstanceOf(Error);
  expect(parseEvery('25h')).toBeInstanceOf(Error);
  expect(parseEvery('soon')).toBeInstanceOf(Error);
});

test('a ledger read back keeps what it can and drops what it cannot use', () => {
  const ledger = withTwo();
  const broken = { ...ledger.proposals[0], prompt: 42 };
  const parsed = parseLedger({
    heartbeat: { owner: 's-1', everyMinutes: 55, places: [{ adapter: 'cmux', surfaceId: 'a', workspaceId: 'b' }, 7] },
    proposals: [broken, ledger.proposals[1], 'junk']
  });
  expect(parsed.proposals.map(({ id }) => id)).toEqual(['p-1']);
  expect(parsed.heartbeat).toEqual({
    owner: 's-1',
    everyMinutes: 55,
    places: [{ adapter: 'cmux', surfaceId: 'a', workspaceId: 'b' }]
  });
  expect(parseLedger('nonsense')).toEqual(EMPTY_LEDGER);
});
