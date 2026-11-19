import type { HostSection, SectionCard } from 'cmux-custom-manager/sections';
import { isShown } from '../../proposals/shown';
import { SCHEMA, type HeartbeatPlace, type HomeEntry, type ProposalItem } from './data';
import { ORANGE, PURPLE, when } from './style';

type Choice = 'start' | 'later' | 'skip';

interface Waiting {
  key: string;
  entry: HomeEntry;
  item: ProposalItem;
}

const nowMs = computed(() => {
  const clock = data.clock();
  return clock ? clock.epoch * 1000 : Date.now();
});

// The heartbeat's place while its tab is still open in cmux; a closed tab can't take the choice.
const reachable = (place: HeartbeatPlace | null): HeartbeatPlace | null =>
  place &&
  (data.workspaces() ?? []).some((workspace) => workspace.tabs.some((tab) => tab.surfaceId === place.surfaceId))
    ? place
    : null;

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

const body = ({ entry, item }: Waiting, decide: (choice: Choice, place: HeartbeatPlace) => void) => {
  const place = () => reachable(entry.heartbeat);
  const choose = (choice: Choice) => () => {
    const target = place();
    if (target) {
      decide(choice, target);
    }
  };
  return VStack({ spacing: 5, alignment: 'leading' }, [
    Text(item.trigger).font(11).color('tertiary'),
    ...(item.quote ? [Text(`“${item.quote}”`).font(11).italic().color('secondary')] : []),
    Text(item.detail).font(11).color('secondary'),
    Text(item.reach).font(10).color('tertiary'),
    when(
      () => place() !== null,
      () =>
        HStack({ spacing: 4 }, [
          choiceButton('Start', choose('start'), entry.colors?.primary ?? PURPLE),
          choiceButton('Later', choose('later')),
          choiceButton('Skip', choose('skip')),
          Spacer({ minLength: 0 })
        ]).paddingTop(3)
    ),
    when(
      () => place() === null,
      () =>
        Text(`Run /heartbeat in one of ${entry.name}’s sessions to start these.`)
          .font(10)
          .color('tertiary')
          .paddingTop(3)
    )
  ]);
};

/**
 * The Manager's PROPOSED section: every joined agent's proposals as cards, those put off hidden until their time. A
 * button types `/propose <choice> <id>` into that agent's heartbeat and hides the card until the refresh lands.
 */
export const proposalsSection = (): HostSection => {
  const [decided, setDecided] = signal<readonly string[]>([]);
  const waiting = computed(() =>
    Object.entries(DATA.homes)
      .filter(([, entry]) => entry.schema === SCHEMA)
      .flatMap(([home, entry]) => entry.proposals.map((item): Waiting => ({ key: `${home}#${item.id}`, entry, item })))
      .filter(({ key, item }) => !decided().includes(key) && isShown(item.laterUntil, nowMs()))
  );
  const card = (proposal: Waiting): SectionCard => {
    const { entry, item, key } = proposal;
    return {
      key,
      title: item.title,
      ...(item.estimate ? { span: `~${item.estimate}` } : {}),
      badges: [
        { text: entry.name, color: entry.colors?.primary ?? PURPLE },
        ...(item.due ? [{ text: item.due, color: ORANGE, icon: 'calendar' }] : [])
      ],
      searchText: `${item.trigger} ${item.detail}`,
      body: () =>
        body(proposal, (choice, place) => {
          cmux('surface.send_text', {
            surface_id: place.surfaceId,
            workspace_id: place.workspaceId,
            text: `/propose ${choice} ${item.id}\n`
          });
          setDecided([...decided(), key]);
        })
    };
  };
  return {
    label: 'PROPOSED',
    icon: 'tray.full.fill',
    color: PURPLE,
    cards: computed(() => waiting().map(card))
  };
};
