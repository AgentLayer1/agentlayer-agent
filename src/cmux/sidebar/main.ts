/*
 * AgentLayer · cmux sidebar
 * Every agent on this Mac, and the work each one keeps.
 *
 *   Manager   what each agent proposes, then every session, sorted by what needs you (cmux Manager)
 *   Agents    a chip per agent, then the chosen agent's Projects (its tasks and projects by state), Reports (its pins
 *             and newest reports by day) and Goals (the year's theme, then today, this week, this month and this
 *             year), with its dashboard and roadmap a tap away
 *
 * The workspace you're in picks the agent; a chip picks another.
 *
 * Open      cmux right-sidebar set custom agentlayer
 * Check     cmux sidebar validate agentlayer
 *
 * Built from src/cmux/sidebar/ in the agentlayer plugin, where the comments explaining the code live.
 */

import { manager } from 'cmux-custom-manager/manager';
import type { Card } from 'cmux-custom-manager/model';
import { agentPage } from './agent';
import type { StartPage } from './data';
import { proposalsSection } from './proposals';
import { scopedHome, type Pin } from './scope';
import { tabIcon } from './style';

type Tab = StartPage['tab'];

const app = () => {
  const homes = Object.keys(DATA.homes);
  const [tab, setTab] = signal<Tab>(DATA.open?.tab ?? 'manager');
  const [pin, setPin] = signal<Pin | null>(null);
  const workspaces = () => data.workspaces() ?? [];
  const selectedId = computed(() => workspaces().find((workspace) => workspace.selected)?.id ?? '');
  // A pick lasts until another workspace is selected.
  computed(() => {
    const picked = pin();
    if (picked && picked.workspaceId !== selectedId()) {
      setPin(null);
    }
  });
  const current = computed(() => scopedHome(homes, workspaces(), pin()));
  // Built once, so a choice already made stays hidden across a switch of tab.
  const proposed = proposalsSection();
  const heartbeats = new Set(homes.flatMap((home) => DATA.homes[home]?.heartbeat?.surfaceId ?? []));
  // The heartbeat waits in its tab all day; the Manager lists it only when it needs you.
  const isQuietHeartbeat = (card: Card) =>
    card.focusId !== undefined && heartbeats.has(card.focusId) && card.agent.status !== 'needs_input';

  const pill = () =>
    HStack({ spacing: 2 }, [
      tabIcon(
        'square.grid.2x2',
        'Manager',
        () => tab() === 'manager',
        () => setTab('manager')
      ),
      tabIcon(
        'square.stack.3d.up.fill',
        'Agents',
        () => tab() === 'agents',
        () => setTab('agents')
      )
    ])
      .padding(2)
      .background('#7f7f7f1f')
      .cornerRadius(8)
      .fixedSize();

  // Keyed by tab, so leaving one disposes it and coming back builds it fresh.
  return VStack({ spacing: 8 }, [
    ForEach({ items: () => [tab()], key: (name) => name }, (name) =>
      name() === 'manager'
        ? manager({
            header: HStack({ spacing: 8 }, [pill(), Text('Manager').font(13).weight('semibold')]).fixedSize(),
            sections: [proposed],
            exclude: isQuietHeartbeat
          })
        : agentPage({
            pill: pill(),
            home: current,
            homes,
            pick: (home) => setPin({ home, workspaceId: selectedId() })
          })
    ),
    Spacer()
  ]);
};

sidebar(app);
