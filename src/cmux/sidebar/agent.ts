import { chip } from 'cmux-custom-manager/components';
import { agentHeader } from './agents';
import { projectsBody } from './projects';
import { reportsBody } from './reports';
import { toolIcon } from './style';
import { scopedPage } from './view';

type Section = 'projects' | 'reports';

export interface AgentPageOptions {
  pill: View;
  home: () => string | undefined;
  homes: readonly string[];
  pick: (home: string) => void;
}

/**
 * One agent's page: the agents as chips beside the tab pill, then Projects and Reports with the dashboard and
 * roadmap a tap away, opened as full tabs. The chosen section outlasts a switch of agent.
 */
export const agentPage = ({ pill, home, homes, pick }: AgentPageOptions) => {
  const [section, setSection] = signal<Section>('projects');
  return VStack({ spacing: 8 }, [
    agentHeader({ pill, homes, home, pick }),
    scopedPage(home, (entry) => {
      const { dashboard, roadmap } = entry;
      return VStack({ spacing: 8 }, [
        HStack({ spacing: 4 }, [
          chip(
            'Projects',
            () => section() === 'projects',
            () => setSection('projects')
          ),
          chip(
            'Reports',
            () => section() === 'reports',
            () => setSection('reports')
          ),
          Spacer({ minLength: 4 }),
          toolIcon('square.grid.3x3', 'Dashboard', () =>
            cmux('browser.tab.new', { url: `${dashboard}#${section() === 'reports' ? 'reports' : 'today'}` })
          ),
          ...(roadmap ? [toolIcon('map', 'Roadmap', () => cmux('browser.tab.new', { url: roadmap }))] : [])
        ]),
        // Keyed by section, so leaving one disposes it and coming back builds it fresh.
        ForEach({ items: () => [section()], key: (name) => name }, (name) =>
          name() === 'projects' ? projectsBody(entry) : reportsBody(entry)
        )
      ]);
    })
  ]).paddingHorizontal(6);
};
