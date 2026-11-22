import type { HostSection, SectionCard } from 'cmux-custom-manager/sections';
import { isShown, type Choice } from '../../proposals/shown';
import { SCHEMA, type HeartbeatPlace, type HomeEntry, type ProposalItem } from './data';
import { openSession, placeSession } from './session';
import { nowMs, ORANGE, PURPLE, when } from './style';

interface Shown {
  key: string;
  entry: HomeEntry;
  item: ProposalItem;
}

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

export const choiceButton = (label: string, onTap: () => void, tint?: string) =>
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

/**
 * A card's buttons, each typing its command into the agent's heartbeat; with no heartbeat to reach, the hint instead.
 */
export const heartbeatActions = (
  entry: HomeEntry,
  buttons: (type: (command: string) => void) => ReturnType<typeof choiceButton>[],
  hint: string
) => {
  const place = () => heartbeatRoute(entry.heartbeat);
  const type = (command: string) => {
    const target = place();
    if (target) {
      cmux('surface.send_text', { surface_id: target.surfaceId, workspace_id: target.workspaceId, text: `${command}\n` });
    }
  };
  return [
    when(
      () => place() !== null,
      () => HStack({ spacing: 4 }, [...buttons(type), Spacer({ minLength: 0 })]).paddingTop(3)
    ),
    when(
      () => place() === null,
      () => Text(hint).font(10).color('tertiary').paddingTop(3)
    )
  ];
};

const body = ({ entry, item }: Shown, command: (choice: Choice) => string) =>
  VStack({ spacing: 5, alignment: 'leading' }, [
    Text(item.trigger).font(11).color('tertiary'),
    ...(item.quote ? [Text(`“${item.quote}”`).font(11).italic().color('secondary')] : []),
    Text(item.detail).font(11).color('secondary'),
    Text(item.reach).font(10).color('tertiary'),
    ...heartbeatActions(
      entry,
      (type) => [
        choiceButton('Start', () => type(command('start')), entry.colors?.primary ?? PURPLE),
        choiceButton('Later', () => type(command('later'))),
        choiceButton('Skip', () => type(command('skip')))
      ],
      `Run /heartbeat in one of ${entry.name}’s sessions to start these.`
    )
  ]);

const heartbeatBody = (entry: HomeEntry) =>
  VStack({ spacing: 5, alignment: 'leading' }, [
    Text(
      `Opens a session in ${entry.name}’s home that looks for proposals now, then every 55 minutes while the home’s other sessions are active, keeping the best five showing, and refreshes the brain every 6 hours when there’s something new.`
    )
      .font(11)
      .color('secondary'),
    HStack({ spacing: 4 }, [
      choiceButton(
        'Start heartbeat',
        () => openSession(entry, '/heartbeat'),
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
      .map((item): Shown => ({ key: `${home}#${item.id}`, entry, item }))
      .filter(({ item }) => isShown(item.laterUntil, nowMs()));
  const card = (proposal: Shown): SectionCard => {
    const { entry, item, key } = proposal;
    return {
      key,
      title: item.title,
      ...(item.estimate ? { span: `~${item.estimate}` } : {}),
      badges: [
        { text: `${entry.emoji} ${entry.name}`, color: entry.colors?.primary ?? PURPLE },
        ...(item.due ? [{ text: item.due, color: ORANGE, icon: 'calendar' }] : [])
      ],
      ...(item.trigger ? { summary: item.trigger } : {}),
      searchText: `${item.trigger} ${item.detail}`,
      body: () =>
        body(proposal, (choice) => {
          // Start names the workspace the session belongs in, picked here where cmux's workspaces are known.
          const target =
            choice === 'start'
              ? placeSession(entry, {
                  workspace: item.workspace ?? '',
                  folders: item.folder ? [item.folder] : [],
                  words: `${item.title} ${item.trigger}`
                })
              : null;
          return `/proposal ${choice} ${item.id}${target?.kind === 'workspace' ? ` --workspace=${target.id}` : ''}`;
        })
    };
  };
  const heartbeatCard = (home: string, entry: HomeEntry): SectionCard => ({
    key: `${home}#heartbeat`,
    title: `Start ${entry.name}’s heartbeat`,
    badges: [{ text: `${entry.emoji} ${entry.name}`, color: entry.colors?.primary ?? PURPLE }],
    body: () => heartbeatBody(entry)
  });
  const cards = computed(() => [
    ...homes.filter(live).flatMap((home) => waiting(home).map(card)),
    ...homes.filter((home) => !live(home)).flatMap((home) => [heartbeatCard(...home), ...waiting(home).map(card)])
  ]);
  return {
    label: 'PROPOSED',
    icon: 'tray.full.fill',
    color: PURPLE,
    folded: true,
    expandFirst: false,
    cards
  };
};
