import type { HostSection, SectionCard } from 'cmux-custom-manager/sections';
import { isShown } from '../../proposals/shown';
import { SCHEMA, type HeartbeatPlace, type HomeEntry, type ProposalItem } from './data';
import { openSession } from './session';
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

/**
 * Claude, still running: the only agent a heartbeat's tab can hold.
 */
export const isRunningClaude = (agent: { kind: string; status: string }): boolean =>
  agent.kind === 'claude' && agent.status !== 'ended';

/**
 * Where the heartbeat is now: its tab, in whichever workspace holds it, while Claude runs there. A closed tab, the
 * shell Claude exited to, or another agent started in that tab has no route.
 */
export const heartbeatRoute = (place: HeartbeatPlace | null): HeartbeatPlace | null => {
  const found =
    place &&
    (data.workspaces() ?? []).find((workspace) =>
      workspace.tabs.some(
        (tab) =>
          tab.surfaceId === place.surfaceId &&
          (workspace.agents ?? []).some((agent) => agent.panelId === tab.id && isRunningClaude(agent))
      )
    );
  return place && found ? { surfaceId: place.surfaceId, workspaceId: found.id } : null;
};

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
  const place = () => heartbeatRoute(entry.heartbeat);
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

const heartbeatBody = (home: string, entry: HomeEntry) =>
  VStack({ spacing: 5, alignment: 'leading' }, [
    Text(
      `Opens a session in ${entry.name}’s home that looks for proposals every 55 minutes and stays quiet at night, spending a model turn only when fewer than five wait.`
    )
      .font(11)
      .color('secondary'),
    HStack({ spacing: 4 }, [
      choiceButton(
        'Start heartbeat',
        () => openSession(home, entry, '/heartbeat'),
        entry.colors?.primary ?? PURPLE
      ),
      Spacer({ minLength: 0 })
    ]).paddingTop(3)
  ]);

/**
 * The Manager's PROPOSED section: every joined agent's proposals as cards, those put off hidden until their time.
 * Proposals a reachable heartbeat can decide come first; each agent without one follows as a card that starts its
 * heartbeat, then its proposals. A proposal's button types `/proposal <choice> <id>` into that agent's heartbeat; the card
 * leaves when the decision is published and the sidebar redrawn, and stays when it was refused.
 */
export const proposalsSection = (): HostSection => {
  const homes = Object.entries(DATA.homes).filter(([, entry]) => entry.schema === SCHEMA);
  const live = ([, entry]: [string, HomeEntry]) => heartbeatRoute(entry.heartbeat) !== null;
  const waiting = ([home, entry]: [string, HomeEntry]) =>
    entry.proposals
      .map((item): Waiting => ({ key: `${home}#${item.id}`, entry, item }))
      .filter(({ item }) => isShown(item.laterUntil, nowMs()));
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
        body(proposal, (choice, place) =>
          cmux('surface.send_text', {
            surface_id: place.surfaceId,
            workspace_id: place.workspaceId,
            text: `/proposal ${choice} ${item.id}\n`
          })
        )
    };
  };
  const heartbeatCard = (home: string, entry: HomeEntry): SectionCard => ({
    key: `${home}#heartbeat`,
    title: `Start ${entry.name}’s heartbeat`,
    badges: [{ text: entry.name, color: entry.colors?.primary ?? PURPLE }],
    body: () => heartbeatBody(home, entry)
  });
  const cards = computed(() => [
    ...homes.filter(live).flatMap((home) => waiting(home).map(card)),
    ...homes.filter((home) => !live(home)).flatMap((home) => [heartbeatCard(...home), ...waiting(home).map(card)])
  ]);
  return {
    label: 'PROPOSED',
    icon: 'tray.full.fill',
    color: PURPLE,
    folded: () => !homes.some(live),
    cards
  };
};
