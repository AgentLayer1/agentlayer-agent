import { chip } from 'cmux-custom-manager/components';
import { agentHeader, type AgentOptions } from './agents';
import type { HomeEntry, StartPage } from './data';
import { goalsBody } from './goals';
import { projectsBody } from './projects';
import { recentBody } from './recent';
import { reportsBody } from './reports';
import { toolIcon } from './style';
import { scopedPage } from './view';

interface Section {
  id: NonNullable<StartPage['section']>;
  label: string;
  body: (entry: HomeEntry) => View;
}

const PROJECTS: Section = { id: 'projects', label: 'Projects', body: projectsBody };

const SECTIONS: readonly Section[] = [
  PROJECTS,
  { id: 'reports', label: 'Reports', body: reportsBody },
  { id: 'recent', label: 'Recent', body: recentBody },
  { id: 'goals', label: 'Goals', body: goalsBody }
];

/**
 * One agent's page: the agents as chips beside the tab pill, then Projects, Reports, Recent and Goals. The chosen
 * section outlasts a switch of agent.
 */
export const agentPage = (options: AgentOptions) => {
  const [section, setSection] = signal(SECTIONS.find((item) => item.id === DATA.open?.section) ?? PROJECTS);
  return VStack({ spacing: 8 }, [
    agentHeader(options),
    scopedPage(options.home, (entry) =>
      VStack({ spacing: 8 }, [
        HStack({ spacing: 4 }, [
          ...SECTIONS.map((item) =>
            chip(
              item.label,
              () => section() === item,
              () => setSection(item)
            )
          ),
          Spacer({ minLength: 0 }),
          // Keyed by section and agent, so the button follows both.
          ForEach(
            {
              items: () => {
                const id = section().id;
                const url = id === 'goals' ? undefined : entry.folders?.[id];
                return url ? [url] : [];
              },
              key: (url) => url
            },
            (url) => toolIcon('folder', 'Open in Finder', () => openURL(url()))
          )
        ]),
        // Keyed by section, so leaving one disposes it and coming back builds it fresh.
        ForEach({ items: () => [section()], key: (item) => item.label }, (item) => item().body(entry))
      ])
    )
  ]).paddingHorizontal(6);
};
