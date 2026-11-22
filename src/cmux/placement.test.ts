import { expect, test } from 'bun:test';
import { placeFor, type PlaceAgent, type Placement, type PlaceWorkspace } from './sidebar/placement';

const workspace = (id: string, title: string, fields: Partial<PlaceWorkspace> = {}): PlaceWorkspace => ({
  id,
  title,
  directory: '/code/elsewhere',
  selected: false,
  tabs: [],
  ...fields
});

const NOVA: PlaceAgent = { name: 'Nova', home: '/homes/Nova', folders: ['/code/acme-app'], heartbeatSurface: 's-beat' };
const SCOUT: PlaceAgent = { name: 'Scout', home: '/homes/Scout', folders: ['/code/ledger'] };
const ADA: PlaceAgent = { name: 'Ada', home: '/homes/Ada', folders: ['/code/ada-mono'] };

// One agent alone, one with a group of workspaces by kind of work, one with a group of two; and a workspace opened in
// Nova's home that holds its heartbeat.
const LAYOUT: PlaceWorkspace[] = [
  workspace('w-beat', '…/homes/Nova', { directory: '/homes/Nova', tabs: [{ surfaceId: 's-beat', directory: '/homes/Nova' }] }),
  workspace('w-nova', 'Agent Nova', { directory: '/homes/Nova' }),
  workspace('w-scout', 'Agent Scout', { directory: '/homes/Scout', group: 'g1', selected: true }),
  workspace('w-vendors', 'Vendor Integrations', { group: 'g1' }),
  workspace('w-reviews', 'Code Reviews', { group: 'g1', directory: '/code/ledger' }),
  workspace('w-investigate', 'Investigate Issues', { group: 'g1' }),
  workspace('w-gh', 'GitHub Issues', { group: 'g1' }),
  workspace('w-testing', 'Testing', { group: 'g1' }),
  workspace('w-kyc', 'Compliance & KYC', { group: 'g1' }),
  workspace('w-ada', 'Agent Ada', { directory: '/homes/Ada', group: 'g2' }),
  workspace('w-mono', 'Monorepo', { directory: '/code/ada-mono', group: 'g2' })
];

const place = (agent: PlaceAgent, hint: Parameters<typeof placeFor>[3], layout = LAYOUT) =>
  placeFor(
    layout,
    agent,
    [NOVA, SCOUT, ADA].filter((other) => other !== agent),
    hint
  );

const at = (id: string): Placement => ({ kind: 'workspace', id });

test("a task of an agent with no workspace for its kind opens in the agent's own, never the selected agent's", () => {
  expect(place(NOVA, { names: ['pray-watch', 'Pray Watch'], words: 'Release the 28.1 build' })).toEqual(at('w-nova'));
});

test('words of the work find the workspace for that kind of work', () => {
  expect(place(SCOUT, { words: 'Review PR #412 on the payouts service' })).toEqual(at('w-reviews'));
  expect(place(SCOUT, { words: 'Investigating why the settlement job failed' })).toEqual(at('w-investigate'));
  expect(place(SCOUT, { words: 'Answer the GitHub issue #12' })).toEqual(at('w-gh'));
  expect(place(SCOUT, { words: 'Run the KYC checks for the new merchant' })).toEqual(at('w-kyc'));
  expect(place(SCOUT, { words: 'Write tests for the refund flow' })).toEqual(at('w-testing'));
});

test('one generic word shared with a title is not a match', () => {
  expect(place(SCOUT, { words: 'Triage the issue the customer raised' })).toEqual(at('w-scout'));
});

test('a workspace the agent picked wins, and one since closed falls back to the words, then the anchor', () => {
  expect(place(SCOUT, { workspace: 'Vendor Integrations', words: 'Review the vendor contract' })).toEqual(at('w-vendors'));
  expect(place(SCOUT, { workspace: 'Deploys', words: 'Review the deploy' })).toEqual(at('w-reviews'));
  expect(place(SCOUT, { workspace: 'Deploys', words: 'Ship it' })).toEqual(at('w-scout'));
});

test("another agent's workspace is never chosen, however well its title fits", () => {
  expect(place(NOVA, { workspace: 'Code Reviews', words: 'Review the code' })).toEqual(at('w-nova'));
  expect(place(NOVA, { folders: ['/code/ada-mono'], names: ['Monorepo'] })).toEqual(at('w-nova'));
});

test("the work's folder places it, but the home folder says nothing, and the heartbeat's tab is passed over", () => {
  const sandbox = workspace('w-sandbox', 'Sandbox', { directory: '/code/acme-app/apps/web' });
  expect(place(NOVA, { folders: ['/code/acme-app'] }, [...LAYOUT, sandbox])).toEqual(at('w-sandbox'));
  expect(place(NOVA, { folders: ['/homes/Nova'] })).toEqual(at('w-nova'));
  const noAnchor = LAYOUT.filter((item) => item.id !== 'w-nova');
  expect(place(NOVA, { folders: ['/homes/Nova'] }, noAnchor)).toEqual(at('w-beat'));
});

test('a group is matched by its anchor, so a member opened anywhere still belongs to its agent', () => {
  expect(place(ADA, { names: ['monorepo'] })).toEqual(at('w-mono'));
  expect(place(SCOUT, { names: ['monorepo'] })).toEqual(at('w-scout'));
});

test("remote workspaces never qualify, and with no anchor and another agent's selected, a new workspace opens", () => {
  const remote = LAYOUT.map((item) => (item.id === 'w-nova' ? { ...item, remote: { connected: true } } : item));
  expect(place(NOVA, { words: 'x' }, remote)).toEqual(at('w-beat'));
  const bare: PlaceWorkspace[] = [workspace('w-scout', 'Agent Scout', { directory: '/homes/Scout', selected: true })];
  expect(place(NOVA, { words: 'x' }, bare)).toEqual({ kind: 'new' });
  expect(place(NOVA, { words: 'x' }, [workspace('w-free', 'Scratch', { selected: true })])).toEqual(at('w-free'));
});

test("two agents anchored in one group share it: neither claims the other's anchor or the group by itself", () => {
  const shared = [
    workspace('w-nova', 'Agent Nova', { directory: '/homes/Nova', group: 'g' }),
    workspace('w-ada', 'Agent Ada', { directory: '/homes/Ada', group: 'g' }),
    workspace('w-ada-reviews', 'Ada reviews', { directory: '/code/ada-mono', group: 'g' })
  ];
  expect(place(NOVA, { words: 'Review the PR' }, shared)).toEqual(at('w-nova'));
  expect(place(NOVA, { workspace: 'Agent Ada' }, shared)).toEqual(at('w-nova'));
  expect(place(ADA, { words: 'Review the PR' }, shared)).toEqual(at('w-ada-reviews'));
});

test("INBOX's fallback is the focused workspace, then the agent's own, and never another agent's focused one", () => {
  const unowned = [...LAYOUT, workspace('w-loose', 'Downloads', { directory: '/Users/ada/Downloads', selected: true })].map(
    (item) => (item.id === 'w-scout' ? { ...item, selected: false } : item)
  );
  const inbox = (layout: PlaceWorkspace[]) =>
    placeFor(layout, NOVA, [SCOUT, ADA], { words: 'nothing that fits' }, 'selected');
  expect(inbox(unowned), 'the focused workspace, belonging to no agent').toEqual({ kind: 'workspace', id: 'w-loose' });
  expect(inbox(LAYOUT), "Scout's is focused, so Nova's own").toEqual({ kind: 'workspace', id: 'w-nova' });
  expect(place(NOVA, { words: 'nothing that fits' }, unowned), 'the default still prefers the agent’s own').toEqual({
    kind: 'workspace',
    id: 'w-nova'
  });
});

test('ties go to the most recently active workspace', () => {
  const twins = [
    workspace('w-scout', 'Agent Scout', { directory: '/homes/Scout', group: 'g1' }),
    workspace('w-old', 'Code Reviews', { group: 'g1', latestAt: 100 }),
    workspace('w-new', 'Code Reviews', { group: 'g1', latestAt: 200 })
  ];
  expect(place(SCOUT, { words: 'review' }, twins)).toEqual(at('w-new'));
});
