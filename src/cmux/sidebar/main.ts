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

import { chip } from 'cmux-custom-manager/components';
import { SECTIONS } from 'cmux-custom-manager/model';
import { createAsk } from './ask';
import { needsIn } from './cards';
import { agentsPage } from './pages/agents';
import { askPage } from './pages/ask';
import { homePage } from './pages/home';
import { scopedHome, type Pin } from './scope';
import { homeLabel } from './view';

const PAGES = ['Home', 'Agents', 'Ask'] as const;
type Page = (typeof PAGES)[number];

const app = () => {
  const homes = Object.keys(DATA.homes);
  const [page, setPage] = signal<Page>('Home');
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

  const ask = createAsk();
  const views: Record<Page, () => View> = {
    Home: () => homePage(current, homes),
    Agents: () => agentsPage(homes),
    Ask: () => askPage(ask, current)
  };

  const agentChip = (home: () => string) => {
    const active = () => current() === home();
    return HStack({ spacing: 4 }, [
      Text(homeLabel(home()))
        .font(11)
        .weight('semibold')
        .color(() => (active() ? 'primary' : 'secondary')),
      ForEach({ items: () => [needsIn(homes, home()).length].filter(Boolean), key: () => 'needs' }, (count) =>
        Text(() => String(count()))
          .font(9)
          .weight('bold')
          .monospaced()
          .color(SECTIONS.needs.color)
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
    HStack({ spacing: 4 }, [
      ...PAGES.map((name) =>
        chip(
          name,
          () => page() === name,
          () => setPage(name)
        )
      ),
      Spacer()
    ]).paddingHorizontal(6),
    Divider(),
    // Keyed by page, so leaving a page disposes it and coming back builds it fresh.
    ForEach({ items: () => [page()], key: (name) => name }, (name) => views[name()]()),
    Spacer()
  ]).paddingHorizontal(6);
};

sidebar(app);
