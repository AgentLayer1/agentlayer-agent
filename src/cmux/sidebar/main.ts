/*
 * AgentLayer · cmux sidebar
 * Every agent on this Mac, and the work each one keeps.
 *
 *   Manager   every session, sorted by what needs you (cmux Manager)
 *   Projects  a search over the agent's tasks, every task at a glance, and its projects by state
 *
 * The workspace you're in picks the agent; a chip on Projects picks another.
 *
 * Open      cmux right-sidebar set custom agentlayer
 * Check     cmux sidebar validate agentlayer
 *
 * Built from src/cmux/sidebar/ in the agentlayer plugin, where the comments explaining the code live.
 */

import { manager } from 'cmux-custom-manager/manager';
import { projectsPage } from './pages/projects';
import { scopedHome, type Pin } from './scope';
import { tabIcon } from './style';

type Tab = 'manager' | 'projects';

const app = () => {
  const homes = Object.keys(DATA.homes);
  const [tab, setTab] = signal<Tab>('manager');
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

  // The tab pill, then the open tab's name.
  const tabs = (title: string) =>
    HStack({ spacing: 8 }, [
      HStack({ spacing: 2 }, [
        tabIcon(
          'square.grid.2x2',
          'Manager',
          () => tab() === 'manager',
          () => setTab('manager')
        ),
        tabIcon(
          'square.stack.3d.up.fill',
          'Projects',
          () => tab() === 'projects',
          () => setTab('projects')
        )
      ])
        .padding(2)
        .background('#7f7f7f1f')
        .cornerRadius(8),
      Text(title).font(13).weight('semibold')
    ]).fixedSize();

  // Keyed by tab, so leaving one disposes it and coming back builds it fresh.
  return VStack({ spacing: 8 }, [
    ForEach({ items: () => [tab()], key: (name) => name }, (name) =>
      name() === 'manager'
        ? manager({ header: tabs('Manager') })
        : projectsPage({
            tabs: tabs('Projects'),
            home: current,
            homes,
            pick: (home) => setPin({ home, workspaceId: selectedId() })
          })
    ),
    Spacer()
  ]);
};

sidebar(app);
