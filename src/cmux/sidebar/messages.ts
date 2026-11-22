import type { CardBadge, HostSection, SectionCard } from 'cmux-custom-manager/sections';
import { isShown } from '../../shared/message';
import { SCHEMA, type HomeEntry, type NoteItem, type ProposalItem } from './data';
import { clock, dayTitle } from './days';
import { heartbeatRoute } from './heartbeat';
import type { WorkHint } from './placement';
import { openSession, placeSession } from './session';
import { ACCENT, nowMs, ORANGE, PINK, PURPLE, when } from './style';
import { today } from './tasks';

type Message = { kind: 'proposal'; item: ProposalItem } | { kind: 'note'; item: NoteItem };

interface Placed {
  entry: HomeEntry;
  message: Message;
}

const PROPOSAL_BADGE: CardBadge = { text: 'Proposal', color: PINK, icon: 'sparkles' };
const NOTE_BADGE: CardBadge = { text: 'Note', color: ACCENT, icon: 'note.text' };

const choiceButton = (label: string, onTap: () => void, tint?: string) =>
  Text(label)
    .font(11)
    .weight('semibold')
    .color(tint ? '#ffffff' : 'secondary')
    .paddingHorizontal(tint ? 14 : 9)
    .paddingVertical(5)
    .background(tint ?? null)
    .cornerRadius(8)
    .hoverBackground(tint ?? '#7f7f7f3d')
    .cursor('pointer')
    .fixedSize('horizontal')
    .onTap(onTap);

// When a note went out: its time today, else its day.
const sentAt = (at: string): string => {
  const day = at.slice(0, 10);
  return day === today() ? clock(at.slice(11, 16)) : dayTitle(day, today());
};

type Tone = 'secondary' | 'tertiary';

// One line of a card's details under a small symbol saying what it is: why now, the next step, a limit, a source.
const fact = (symbol: string, text: string, tone: Tone, look: { italic?: boolean; oneLine?: boolean } = {}) => {
  const plain = Text(text).font(11).color(tone);
  const styled = look.italic ? plain.italic() : plain;
  return HStack({ spacing: 5, alignment: 'top' }, [
    Image(symbol).font(9).color(tone).frame({ width: 12 }).paddingTop(2),
    look.oneLine ? styled.lineLimit(1).truncation('middle') : styled
  ]);
};

// What tells one kind from the other: where Start places its session, the details, and the face of the closed card.
// The details read the same way for both: what it is in full colour, why and what next a step dimmer, then the limits.
const lookOf = (message: Message) => {
  if (message.kind === 'proposal') {
    const { item } = message;
    return {
      hint: {
        workspace: item.workspace ?? '',
        folders: item.folder ? [item.folder] : [],
        words: `${item.title} ${item.trigger}`
      } satisfies WorkHint,
      details: () => [
        Text(item.detail).font(11),
        fact('bolt.fill', item.trigger, 'secondary'),
        ...(item.quote ? [fact('quote.opening', item.quote, 'secondary', { italic: true })] : []),
        fact('lock.fill', item.reach, 'tertiary')
      ],
      face: {
        ...(item.estimate ? { span: `~${item.estimate}` } : {}),
        badges: [PROPOSAL_BADGE, ...(item.due ? [{ text: item.due, color: ORANGE, icon: 'calendar' }] : [])],
        ...(item.trigger ? { summary: item.trigger } : {}),
        searchText: `${item.trigger} ${item.detail}`
      }
    };
  }
  const { item } = message;
  return {
    hint: {
      workspace: item.workspace,
      folders: item.folder ? [item.folder] : [],
      words: `${item.title} ${item.next}`
    } satisfies WorkHint,
    details: () => [
      Text(item.body).font(11),
      fact('arrow.turn.down.right', item.next, 'secondary'),
      VStack(
        { spacing: 1, alignment: 'leading' },
        item.sources.map((source) => fact('paperclip', source, 'tertiary', { oneLine: true }))
      )
    ],
    face: { span: sentAt(item.at), badges: [NOTE_BADGE], summary: item.next, searchText: `${item.body} ${item.next}` }
  };
};

// The card's three buttons, each typing its command into the agent's heartbeat; with no heartbeat to reach, the hint.
const actions = (entry: HomeEntry, id: string, start: () => string) => {
  const route = computed(() => heartbeatRoute(entry.heartbeat));
  const type = (command: string) => {
    const target = route();
    if (target) {
      cmux('surface.send_text', {
        surface_id: target.surfaceId,
        workspace_id: target.workspaceId,
        text: `${command}\n`
      });
    }
  };
  return [
    when(
      () => route() !== null,
      () =>
        HStack({ spacing: 4 }, [
          choiceButton('Start', () => type(start()), entry.colors?.primary ?? PURPLE),
          choiceButton('Later', () => type(`/message later ${id}`)),
          choiceButton('Dismiss', () => type(`/message dismiss ${id}`)),
          Spacer({ minLength: 0 })
        ]).paddingTop(3)
    ),
    when(
      () => route() === null,
      () =>
        Text(`Run /heartbeat in one of ${entry.name}’s sessions to act on these here.`)
          .font(10)
          .color('tertiary')
          .paddingTop(3)
    )
  ];
};

const card = ({ entry, message }: Placed): SectionCard => {
  const { item } = message;
  const { hint, details, face } = lookOf(message);
  // Start names the workspace the session belongs in, picked at the tap, where cmux's workspaces are known: the one that
  // fits the work, else the focused one, never another agent's.
  const start = () => {
    const target = placeSession(entry, hint, 'selected');
    return `/message start ${item.id}${target.kind === 'workspace' ? ` --workspace=${target.id}` : ''}`;
  };
  return {
    key: `${entry.home}#${item.id}`,
    title: item.title,
    ...face,
    body: () => VStack({ spacing: 5, alignment: 'leading' }, [...details(), ...actions(entry, item.id, start)])
  };
};

const heartbeatBody = (entry: HomeEntry) =>
  VStack({ spacing: 5, alignment: 'leading' }, [
    Text(
      `Opens a session in ${entry.name}’s home that looks for proposals now, then every 55 minutes while the home’s other sessions are active, keeping the best five showing, and refreshes the brain every 6 hours when there’s something new.`
    )
      .font(11)
      .color('secondary'),
    HStack({ spacing: 4 }, [
      choiceButton('Start heartbeat', () => openSession(entry, '/heartbeat'), entry.colors?.primary ?? PURPLE),
      Spacer({ minLength: 0 })
    ]).paddingTop(3)
  ]);

const heartbeatCard = (entry: HomeEntry): SectionCard => ({
  key: `${entry.home}#heartbeat`,
  title: `Start ${entry.name}’s heartbeat`,
  body: () => heartbeatBody(entry)
});

const newestFirst = (a: Placed, b: Placed) => Date.parse(b.message.item.at) - Date.parse(a.message.item.at);

/**
 * The Manager's INBOX: the messages the agents surfaced on their own, proposals and notes alike, newest first, those
 * put off with Later hidden until their time. It shows the agent `scope` names, or every joined agent when it names
 * none. Messages a reachable heartbeat can decide come first; each agent without one follows as a card that starts its
 * heartbeat, then its messages. A button types `/message <choice> <id>` into that agent's heartbeat.
 */
export const messagesSection = (scope: () => string | undefined): HostSection => {
  const entries = Object.values(DATA.homes).filter((entry) => entry.schema === SCHEMA);
  // The list is rebuilt when the minute, the scope or the set of reachable heartbeats changes, never on a clock tick.
  const minute = computed(() => Math.floor(nowMs() / 60_000) * 60_000);
  const inScope = computed(() => {
    const home = scope();
    return home ? entries.filter((entry) => entry.home === home) : entries;
  });
  const reachable = computed(() =>
    entries
      .filter((entry) => heartbeatRoute(entry.heartbeat) !== null)
      .map((entry) => entry.home)
      .join('\n')
  );
  const waiting = (entry: HomeEntry, now: number): Placed[] =>
    [
      ...entry.proposals.map((item): Message => ({ kind: 'proposal', item })),
      ...(entry.notes ?? []).map((item): Message => ({ kind: 'note', item }))
    ]
      .filter(({ item }) => isShown(item.laterUntil, now))
      .map((message) => ({ entry, message }));
  const cards = computed(() => {
    const now = minute();
    const live = new Set(reachable().split('\n'));
    return [
      ...inScope()
        .filter((entry) => live.has(entry.home))
        .flatMap((entry) => waiting(entry, now))
        .toSorted(newestFirst)
        .map(card),
      ...inScope()
        .filter((entry) => !live.has(entry.home))
        .flatMap((entry) => [heartbeatCard(entry), ...waiting(entry, now).toSorted(newestFirst).map(card)])
    ];
  });
  return {
    label: 'INBOX',
    icon: 'tray.full.fill',
    color: PURPLE,
    folded: true,
    expandFirst: false,
    cards
  };
};
