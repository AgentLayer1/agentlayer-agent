import { chip } from 'cmux-custom-manager/components';
import { agentHeader, type AgentOptions } from './agents';
import type { HomeEntry } from './data';
import { goalsBody } from './goals';
import { projectsBody } from './projects';
import { reportsBody } from './reports';
import { toolIcon } from './style';
import { scopedPage } from './view';

interface Section {
  id: 'projects' | 'reports' | 'goals';
  label: string;
  /**
   * The dashboard page its Dashboard icon opens.
   */
  page: string;
  body: (entry: HomeEntry) => View;
}

const PROJECTS: Section = { id: 'projects', label: 'Projects', page: 'today', body: projectsBody };

const SECTIONS: readonly Section[] = [
  PROJECTS,
  { id: 'reports', label: 'Reports', page: 'reports', body: reportsBody },
  { id: 'goals', label: 'Goals', page: 'today/goals', body: goalsBody }
];

/**
 * One agent's page: the agents as chips beside the tab pill, then Projects, Reports and Goals with the dashboard and
 * roadmap a tap away, opened as full tabs. The chosen section outlasts a switch of agent.
 */
export const agentPage = (options: AgentOptions) => {
  const [section, setSection] = signal(SECTIONS.find((item) => item.id === DATA.open?.section) ?? PROJECTS);
  return VStack({ spacing: 8 }, [
    agentHeader(options),
    scopedPage(options.home, (entry) => {
      const { dashboard, roadmap } = entry;
      return VStack({ spacing: 8 }, [
        HStack({ spacing: 4 }, [
          ...SECTIONS.map((item) =>
            chip(
              item.label,
              () => section() === item,
              () => setSection(item)
            )
          ),
          Spacer({ minLength: 4 }),
          toolIcon('square.grid.3x3', 'Dashboard', () =>
            cmux('browser.tab.new', { url: `${dashboard}#${section().page}` })
          ),
          ...(roadmap ? [toolIcon('map', 'Roadmap', () => cmux('browser.tab.new', { url: roadmap }))] : [])
        ]),
        // Keyed by section, so leaving one disposes it and coming back builds it fresh.
        ForEach({ items: () => [section()], key: (item) => item.label }, (item) => item().body(entry))
      ]);
    })
  ]).paddingHorizontal(6);
};
