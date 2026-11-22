import type { HostSection, SectionCard } from 'cmux-custom-manager/sections';
import { isShown } from '../../proposals/shown';
import { SCHEMA, type HomeEntry, type NoteItem, type ProposalItem } from './data';
import { choiceButton, heartbeatActions, heartbeatRoute } from './heartbeat';
import { openSession, placeSession } from './session';
import { ACCENT, nowMs, ORANGE, PURPLE } from './style';

type Message = { kind: 'proposal'; item: ProposalItem } | { kind: 'note'; item: NoteItem };

interface Shown {
  key: string;
  entry: HomeEntry;
  message: Message;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const hhmm = (iso: string): string => iso.slice(11, 16);

// Start names the workspace the session belongs in, picked here where cmux's workspaces are known.
const startCommand = (entry: HomeEntry, message: Message): string => {
  const target =
    message.kind === 'proposal'
      ? placeSession(entry, {
          workspace: message.item.workspace ?? '',
          folders: message.item.folder ? [message.item.folder] : [],
          words: `${message.item.title} ${message.item.trigger}`
        })
      : placeSession(entry, { words: `${message.item.title} ${message.item.next}` });
  return `/message start ${message.item.id}${target.kind === 'workspace' ? ` --workspace=${target.id}` : ''}`;
};

const details = (message: Message) =>
  message.kind === 'proposal'
    ? [
        Text(message.item.trigger).font(11).color('tertiary'),
        ...(message.item.quote ? [Text(`“${message.item.quote}”`).font(11).italic().color('secondary')] : []),
        Text(message.item.detail).font(11).color('secondary'),
        Text(message.item.reach).font(10).color('tertiary')
      ]
    : [
        Text(message.item.body).font(11).color('secondary'),
        Text(`Next: ${message.item.next}`).font(11),
        ...message.item.sources.map((url) => Text(url).font(10).color('tertiary').lineLimit(1).truncation('middle'))
      ];

const body = ({ entry, message }: Shown) =>
  VStack({ spacing: 5, alignment: 'leading' }, [
    ...details(message),
    ...heartbeatActions(
      entry,
      (type) => [
        choiceButton('Start', () => type(startCommand(entry, message)), entry.colors?.primary ?? PURPLE),
        choiceButton('Later', () => type(`/message later ${message.item.id}`)),
        choiceButton('Dismiss', () => type(`/message dismiss ${message.item.id}`))
      ],
      `Run /heartbeat in one of ${entry.name}’s sessions to act on these here.`
    )
  ]);

const PROPOSAL_BADGE = { text: 'Proposal', color: PURPLE, icon: 'sparkles' };
const NOTE_BADGE = { text: 'Note', color: ACCENT, icon: 'note.text' };

const card = (shown: Shown): SectionCard => {
  const { message, key } = shown;
  if (message.kind === 'proposal') {
    const { item } = message;
    return {
      key,
      title: item.title,
      ...(item.estimate ? { span: `~${item.estimate}` } : {}),
      badges: [PROPOSAL_BADGE, ...(item.due ? [{ text: item.due, color: ORANGE, icon: 'calendar' }] : [])],
      ...(item.trigger ? { summary: item.trigger } : {}),
      searchText: `${item.trigger} ${item.detail}`,
      body: () => body(shown)
    };
  }
  const { item } = message;
  return {
    key,
    title: item.title,
    span: hhmm(item.at),
    badges: [NOTE_BADGE],
    summary: item.next,
    searchText: `${item.body} ${item.next}`,
    body: () => body(shown)
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

const heartbeatCard = (home: string, entry: HomeEntry): SectionCard => ({
  key: `${home}#heartbeat`,
  title: `Start ${entry.name}’s heartbeat`,
  body: () => heartbeatBody(entry)
});

/**
 * The Manager's INBOX: the messages the agents surfaced on their own, proposals and notes alike, newest first, those
 * put off with Later hidden until their time. It shows the agent `scope` names, or every joined agent when it names
 * none. Messages a reachable heartbeat can decide come first; each agent without one follows as a card that starts its
 * heartbeat, then its messages. A button types `/message <choice> <id>` into that agent's heartbeat.
 */
export const messagesSection = (scope: () => string | undefined): HostSection => {
  const homes = Object.entries(DATA.homes).filter(([, entry]) => entry.schema === SCHEMA);
  const inScope = computed(() => {
    const home = scope();
    return home ? homes.filter(([path]) => path === home) : homes;
  });
  const live = ([, entry]: [string, HomeEntry]) => heartbeatRoute(entry.heartbeat) !== null;
  const waiting = ([home, entry]: [string, HomeEntry]): Shown[] =>
    [
      ...entry.proposals.map((item): Message => ({ kind: 'proposal', item })),
      ...(entry.notes ?? []).map((item): Message => ({ kind: 'note', item }))
    ]
      .filter(({ item }) => isShown(item.laterUntil, nowMs()))
      .map((message) => ({ key: `${home}#${message.item.id}`, entry, message }));
  const newestFirst = (a: Shown, b: Shown) => Date.parse(b.message.item.at) - Date.parse(a.message.item.at);
  const cards = computed(() => [
    ...inScope().filter(live).flatMap(waiting).toSorted(newestFirst).map(card),
    ...inScope()
      .filter((home) => !live(home))
      .flatMap((home) => [heartbeatCard(...home), ...waiting(home).toSorted(newestFirst).map(card)])
  ]);
  // A note from the last day opens the section; otherwise it waits folded, every card closed.
  const fresh = () =>
    inScope().some(([, entry]) => (entry.notes ?? []).some((note) => nowMs() - Date.parse(note.at) < DAY_MS));
  return {
    label: 'INBOX',
    icon: 'tray.full.fill',
    color: PURPLE,
    folded: () => !fresh(),
    expandFirst: false,
    cards
  };
};
