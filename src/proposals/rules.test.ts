import { expect, test } from 'bun:test';
import { TIMEZONE } from '@/config';
import { nextMorning } from '@/shared/date';
import { EMPTY_LEDGER, parseLedger, type ProposalLedger } from './ledger';
import {
  addProposals,
  BACKLOG,
  decide,
  proposalCards,
  type ProposalInput,
  retireProposals,
  roomFor,
  showingNow,
  swapProposals
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

test('a started source rests a day and a dismissed one a week', () => {
  const started = decide(withTwo(), 'p-0', 'start', NOW);
  const dismissed = started.outcome === 'decided' ? decide(started.ledger, 'p-1', 'dismiss', NOW) : started;
  if (dismissed.outcome !== 'decided') {
    throw new Error('expected both decisions to land');
  }
  const again = [input('task:aa-001'), input('sync')];
  const nextDay = new Date(NOW.getTime() + 25 * 60 * 60 * 1000);
  const nextWeek = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);
  expect(addProposals(dismissed.ledger, again, NOW).refused.map(({ reason }) => reason)).toEqual([
    'started in the last day',
    'dismissed in the last week'
  ]);
  expect(addProposals(dismissed.ledger, again, nextDay).refused.map(({ reason }) => reason)).toEqual([
    'dismissed in the last week'
  ]);
  expect(addProposals(dismissed.ledger, again, nextWeek).refused).toEqual([]);
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
  expect(showingNow(putOff, NOW)).toEqual([]);
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
  expect(showingNow(later.ledger, NOW).map(({ id }) => id)).toEqual(['p-1']);
  const back = new Date(Date.parse(later.item.laterUntil));
  expect(showingNow(later.ledger, back).map(({ id }) => id)).toEqual(['p-0', 'p-1']);
});

test('what a surface is given never carries a prompt or a source', () => {
  const cards = proposalCards(withTwo());
  expect(cards).toHaveLength(2);
  expect(JSON.stringify(cards)).not.toContain('Secret prompt');
  expect(cards.every((card) => !('source' in card) && !('prompt' in card))).toBe(true);
});

test("a ledger written before Skip became Dismiss reads its skipped proposals as dismissed", () => {
  const [proposal] = withTwo().proposals;
  expect(parseLedger({ proposals: [{ ...proposal, state: 'skipped' }] }).proposals[0]?.state).toBe('dismissed');
});

test('a ledger read back keeps what it can and drops what it cannot use', () => {
  const ledger = withTwo();
  const broken = { ...ledger.proposals[0], prompt: 42 };
  const parsed = parseLedger({ proposals: [broken, ledger.proposals[1], 'junk'] });
  expect(parsed.proposals.map(({ id }) => id)).toEqual(['p-1']);
  expect(parseLedger('nonsense')).toEqual(EMPTY_LEDGER);
});

test('retiring withdraws a showing proposal, whose source can come straight back', () => {
  const { ledger, retired, refused } = retireProposals(withTwo(), [{ id: 'p-0', reason: 'outranked' }], NOW);
  expect(retired).toEqual([{ id: 'p-0', title: 'Do task:aa-001', reason: 'outranked' }]);
  expect(refused).toEqual([]);
  expect(showingNow(ledger, NOW).map(({ id }) => id)).toEqual(['p-1']);
  expect(addProposals(ledger, [input('task:aa-001')], NOW).added).toHaveLength(1);
});

test('retiring refuses what the operator owns: one put off, one decided, one unknown', () => {
  const later = decide(withTwo(), 'p-0', 'later', NOW);
  const started = later.outcome === 'decided' ? decide(later.ledger, 'p-1', 'start', NOW) : later;
  if (started.outcome !== 'decided') {
    throw new Error('the fixture decisions should apply');
  }
  const reasons = ['p-0', 'p-1', 'p-9'].map((id) => ({ id, reason: 'x' }));
  const { ledger, retired, refused } = retireProposals(started.ledger, reasons, NOW);
  expect(retired).toEqual([]);
  expect(refused).toEqual([
    { id: 'p-0', reason: 'put off by the operator' },
    { id: 'p-1', reason: 'already started' },
    { id: 'p-9', reason: 'no such proposal' }
  ]);
  expect(ledger).toBe(started.ledger);
});

test('a ledger written before folder and workspace existed still reads, with both empty', () => {
  const { ledger } = addProposals(EMPTY_LEDGER, [input('sync')], NOW, counter());
  const old = JSON.parse(JSON.stringify(ledger)) as { proposals: Record<string, unknown>[] };
  old.proposals.forEach((proposal) => {
    delete proposal.folder;
    delete proposal.workspace;
  });
  const [read] = parseLedger(old).proposals;
  expect([read?.id, read?.folder, read?.workspace]).toEqual(['p-0', '', '']);
});

test('a swap retires first, so a full backlog still takes the replacement, and a refused one puts its card back', () => {
  const full = addProposals(
    EMPTY_LEDGER,
    Array.from({ length: BACKLOG }, (_, index) => input(`task:aa-${index}`)),
    NOW,
    counter()
  ).ledger;
  const swapped = swapProposals(full, [input('task:bb-1')], [{ id: 'p-0', reason: 'outranked', for: 'task:bb-1' }], NOW);
  expect(swapped.added.map(({ source }) => source)).toEqual(['task:bb-1']);
  expect(swapped.retired.map(({ id }) => id)).toEqual(['p-0']);
  const refused = swapProposals(full, [input('task:aa-3')], [{ id: 'p-0', reason: 'outranked', for: 'task:aa-3' }], NOW);
  expect(refused.added).toEqual([]);
  expect(refused.retired).toEqual([]);
  expect(refused.kept).toEqual([{ id: 'p-0', reason: 'its replacement was refused' }]);
  expect(refused.ledger.proposals.find(({ id }) => id === 'p-0')?.state).toBe('waiting');
});
