/*
 * AgentLayer · cmux sidebar
 * Every agent on this Mac: who needs you, and a tap to what each one keeps.
 * The workspace you're in picks the agent; the chips on top pick another.
 *
 * Open      cmux right-sidebar set custom agentlayer
 * Check     cmux sidebar validate agentlayer
 *
 * Built from src/cmux/sidebar/ in the agentlayer plugin, where the comments explaining the code live.
 */

import { agentCards } from 'cmux-custom-dashboard/model';
import { homePage } from './pages/home';
import { homeOf, scopedHome, type Pin } from './scope';
import { NEEDS_COLOR } from './style';

const app = () => {
  const homes = Object.keys(DATA.homes);
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
  const needsIn = (home: string) =>
    agentCards().filter((card) => card.section === 'needs' && homeOf(homes, card.agent.directory) === home).length;

  const agentChip = (home: () => string) => {
    const entry = DATA.homes[home()];
    const active = () => current() === home();
    return HStack({ spacing: 4 }, [
      Text(`${entry?.emoji ?? ''} ${entry?.name ?? ''}`.trim())
        .font(11)
        .weight('semibold')
        .color(() => (active() ? 'primary' : 'secondary')),
      ForEach({ items: () => [needsIn(home())].filter(Boolean), key: () => 'needs' }, (count) =>
        Text(() => String(count()))
          .font(9)
          .weight('bold')
          .monospaced()
          .color(NEEDS_COLOR)
      )
    ])
      .paddingHorizontal(8)
      .paddingVertical(3)
      .cornerRadius(6)
      .background(() => (active() ? '#7f7f7f3d' : null))
      .hoverBackground('#7f7f7f3d')
      .cursor('pointer')
      .fixedSize('horizontal')
      .onTap(() => setPin({ home: home(), workspaceId: selectedId() }));
  };

  return VStack({ spacing: 8 }, [
    HStack({ spacing: 6 }, [
      Image('square.stack.3d.up.fill').font(12).color('accent'),
      Text('AgentLayer').font(13).weight('semibold'),
      Spacer()
    ]).paddingHorizontal(10),
    HStack({ spacing: 4 }, [ForEach({ items: homes, key: (home) => home }, agentChip), Spacer()]).paddingHorizontal(6),
    Divider(),
    homePage(current, homes),
    Spacer()
  ]).paddingHorizontal(6);
};

sidebar(app);
