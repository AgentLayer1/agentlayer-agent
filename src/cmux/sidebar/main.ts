/*
 * AgentLayer · cmux sidebar
 * Every agent on this Mac, and the work each one keeps.
 *
 * The cmux Manager's header and tallies, then four tabs:
 *
 *   Sessions   what each agent proposes, then every session, sorted by what needs you
 *   Projects   the agent's tasks and projects by state, or its goals (the year's theme, then today, this week, this
 *              month and this year)
 *   Reports    the agent's pins and newest reports by day
 *   Recent     the files the agent changed lately, by day
 *
 * The workspace you're in picks the agent; its dashboard, roadmap and folder end the Sessions search row.
 *
 * Open      cmux right-sidebar set custom agentlayer
 * Check     cmux sidebar validate agentlayer
 *
 * Built from src/cmux/sidebar/ in the agentlayer plugin, where the comments explaining the code live.
 */

import { manager } from 'cmux-custom-manager/manager';
import type { Card } from 'cmux-custom-manager/model';
import { SCHEMA, type HomeEntry } from './data';
import { heartbeatRoute, isRunningClaude } from './heartbeat';
import { messagesSection } from './messages';
import { projectsBody } from './projects';
import { recentBody } from './recent';
import { reportsBody } from './reports';
import { scopedHome, workspaceHome } from './scope';
import { folderButton, toolIcon } from './style';
import { scopedPage } from './view';

const app = () => {
  const homes = Object.keys(DATA.homes);
  const workspaces = () => data.workspaces() ?? [];
  const current = computed(() => scopedHome(homes, workspaces()));
  const messages = messagesSection(computed(() => workspaceHome(homes, workspaces())));
  const heartbeats = computed(
    () =>
      new Set(
        Object.values(DATA.homes).flatMap((entry) =>
          entry.schema === SCHEMA ? (heartbeatRoute(entry.heartbeat)?.surfaceId ?? []) : []
        )
      )
  );
  // The heartbeat waits in its tab all day; the Manager lists it only when it needs you.
  const isQuietHeartbeat = (card: Card) =>
    card.focusId !== undefined &&
    heartbeats().has(card.focusId) &&
    isRunningClaude(card.agent) &&
    card.agent.status !== 'needs_input';

  const page = (body: (entry: HomeEntry) => View) => () => scopedPage(current, body);
  const scoped = computed(() => {
    const path = current();
    const entry = path ? DATA.homes[path] : undefined;
    return path && entry?.schema === SCHEMA ? [{ path, entry }] : [];
  });
  // Keyed by home, so the buttons follow the workspace.
  const sessionTools = () =>
    ForEach({ items: scoped, key: (item) => item.path }, (item) => {
      const { dashboard, roadmap, folder } = item().entry;
      return HStack({ spacing: 4 }, [
        toolIcon('square.grid.3x3', 'Dashboard', () => cmux('browser.tab.new', { url: `${dashboard}#today` })),
        ...(roadmap ? [toolIcon('map', 'Roadmap', () => cmux('browser.tab.new', { url: roadmap }))] : []),
        ...folderButton(folder)
      ]).fixedSize();
    });

  return VStack({ spacing: 8 }, [
    manager({
      sections: [messages],
      exclude: isQuietHeartbeat,
      pages: [
        { id: 'projects', label: 'Projects', view: page(projectsBody) },
        { id: 'reports', label: 'Reports', view: page(reportsBody) },
        { id: 'recent', label: 'Recent', view: page(recentBody) }
      ],
      page: DATA.open?.tab,
      searchTrailing: sessionTools
    }),
    Spacer()
  ]);
};

sidebar(app);
