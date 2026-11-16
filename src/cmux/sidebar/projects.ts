import { chip, searchField } from 'cmux-custom-manager/components';
import type { HomeEntry, PinItem, PinTarget, ProjectCard, TaskItem } from './data';
import { BUCKETS, dueBucket, dueLabel, type DueBucket } from './due';
import { groupTitle, hueColor, note, progressBar, toolIcon } from './style';
import { count, taskRow, today } from './tasks';
import { entryOf, homeLabel, scopedPage } from './view';

const ACCENT = '#0A84FF';
const CARD = '#7f7f7f12';

const open = (target: PinTarget) =>
  target.kind === 'page' ? cmux('browser.tab.new', { url: target.url }) : cmux('file.open', { path: target.path });

const linkRow = ({ icon, title, target }: PinItem) =>
  HStack({ spacing: 6 }, [
    Text(icon).font(11).frame({ width: 14 }),
    Text(title).font(11).color('secondary').lineLimit(1).truncation('tail'),
    Spacer({ minLength: 0 })
  ])
    .paddingHorizontal(4)
    .paddingVertical(2)
    .cornerRadius(6)
    .hoverBackground('#7f7f7f26')
    .cursor('pointer')
    .onTap(() => open(target));

const roadmapLink = (url: string): PinItem => ({ title: 'Roadmap', icon: '🗺️', target: { kind: 'page', url } });

const chevron = (expanded: () => boolean) =>
  Image(() => (expanded() ? 'chevron.down' : 'chevron.right'))
    .font(9)
    .weight('semibold')
    .color('tertiary');

const card = (view: View) => view.paddingHorizontal(10).paddingVertical(8).background(CARD).cornerRadius(10);

const fraction = (done: number, live: number) => (done + live ? done / (done + live) : 0);

// Someday is left off: undated tasks would bury the dated ones, and the card's counts still include them.
const AGENDA: Readonly<Partial<Record<DueBucket, string>>> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  month: 'This month',
  later: 'Later'
};

interface Listed {
  task: TaskItem;
  color: string;
}

interface AgendaGroup {
  title: string;
  tasks: Listed[];
}

const listedTasks = (entry: HomeEntry): Listed[] =>
  entry.projects.flatMap((project) => project.tasks.map((task) => ({ task, color: hueColor(project.hue) })));

// In flight leads and carries its own due words, so each task shows once, as on the dashboard's Tasks page.
const agenda = (listed: readonly Listed[], day: string): AgendaGroup[] => {
  const waiting = listed.filter(({ task }) => task.status !== 'active');
  return [
    { title: 'In flight', tasks: listed.filter(({ task }) => task.status === 'active') },
    ...BUCKETS.flatMap((bucket) => {
      const title = AGENDA[bucket];
      return title ? [{ title, tasks: waiting.filter(({ task }) => dueBucket(task.due, day) === bucket) }] : [];
    })
  ].filter((group) => group.tasks.length);
};

const dueTally = (amount: () => number, label: string, color: string) =>
  Text(() => (amount() ? `${amount()} ${label}` : ''))
    .font(10)
    .weight('semibold')
    .color(color);

const tasksCard = (entry: HomeEntry, listed: readonly Listed[]) => {
  const [expanded, setExpanded] = signal(false);
  const total = (field: 'active' | 'blocked' | 'open' | 'done') =>
    entry.projects.reduce((sum, project) => sum + project[field], 0);
  const tone = (wanted: string) => () =>
    listed.filter(({ task }) => dueLabel(task.due, today())?.tone === wanted).length;
  const groups = computed(() => agenda(listed, today()));
  return card(
    VStack({ spacing: 6 }, [
      VStack({ spacing: 6 }, [
        HStack({ spacing: 7 }, [
          Image('checklist').font(11).color(ACCENT),
          Text('Tasks').font(12).weight('semibold'),
          Spacer({ minLength: 4 }),
          ...count(total('active'), 'active'),
          ...count(total('blocked'), 'blocked'),
          ...count(total('open'), 'open'),
          chevron(expanded)
        ]),
        progressBar(fraction(total('done'), total('active') + total('blocked') + total('open')), ACCENT),
        HStack({ spacing: 8 }, [
          dueTally(tone('overdue'), 'overdue', '#FF453A'),
          dueTally(tone('soon'), 'due this week', '#FF9F0A'),
          Spacer({ minLength: 0 })
        ])
      ])
        .cursor('pointer')
        .onTap(() => setExpanded(!expanded())),
      ForEach({ items: () => (expanded() ? groups() : []), key: (group) => group.title }, (group) =>
        VStack({ spacing: 1 }, [
          groupTitle(group().title, group().tasks.length).paddingTop(4),
          ForEach({ items: () => group().tasks, key: (item) => item.task.id }, (item) =>
            taskRow(item().task, item().color)
          )
        ])
      )
    ])
  );
};

// The entry is fixed while the sidebar is loaded (an update arrives as a rewrite), so a card reads its project
// once; only whether it's open is live.
const projectCard = (item: () => ProjectCard) => {
  const project = item();
  const [expanded, setExpanded] = signal(false);
  const color = hueColor(project.hue);
  const next = project.tasks[0];
  const links = [...(project.roadmap ? [roadmapLink(project.roadmap)] : []), ...project.pins];
  return card(
    VStack({ spacing: 6 }, [
      VStack({ spacing: 6 }, [
        HStack({ spacing: 7 }, [
          Circle({ size: 8 }).fill(color),
          Text(project.slug).font(12).weight('semibold').lineLimit(1).truncation('tail'),
          Spacer({ minLength: 4 }),
          ...count(project.active, 'active'),
          ...count(project.blocked, 'blocked'),
          ...count(project.open, 'open'),
          ...(links.length ? [Image('pin.fill').font(8).color('tertiary').help(`${links.length} pinned`)] : []),
          chevron(expanded)
        ]),
        progressBar(fraction(project.done, project.active + project.blocked + project.open), color),
        ForEach({ items: () => (next && !expanded() ? [next] : []), key: (task) => task.id }, (task) =>
          HStack({ spacing: 5 }, [
            Image('arrow.turn.down.right').font(8).color('quaternary'),
            Text(task().title).font(11).color('secondary').lineLimit(1).truncation('tail'),
            Spacer({ minLength: 0 })
          ])
        )
      ])
        .cursor('pointer')
        .onTap(() => setExpanded(!expanded())),
      // One item while open: an empty stack would still take the card's spacing and pad a folded card's foot.
      ForEach({ items: () => (expanded() ? [project.slug] : []), key: (slug) => slug }, () =>
        VStack({ spacing: 6 }, [
          ...(links.length
            ? [
                VStack({ spacing: 0 }, [
                  ForEach({ items: links, key: (link) => link.title }, (link) => linkRow(link()))
                ])
              ]
            : []),
          VStack({ spacing: 1 }, [ForEach({ items: project.tasks, key: (task) => task.id }, (task) => taskRow(task()))])
        ])
      )
    ])
  ).frame({ maxWidth: 'infinity' });
};

const STATES = [
  { title: 'At work', holds: (project: ProjectCard) => project.active > 0 },
  { title: 'Blocked', holds: (project: ProjectCard) => !project.active && project.blocked > 0 },
  { title: 'Quiet', holds: (project: ProjectCard) => !project.active && !project.blocked }
];

const stateGroup = (title: string, projects: ProjectCard[]) => {
  const [expanded, setExpanded] = signal(true);
  return VStack({ spacing: 6 }, [
    HStack({ spacing: 4 }, [groupTitle(title, projects.length), chevron(expanded)])
      .paddingTrailing(4)
      .cursor('pointer')
      .onTap(() => setExpanded(!expanded())),
    ForEach({ items: () => (expanded() ? projects : []), key: (project) => project.slug }, projectCard)
  ]);
};

const matches = (listed: readonly Listed[], query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return listed.filter(({ task }) => {
    const haystack = `${task.title} ${task.id}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
};

const projectsBody = (entry: HomeEntry) => {
  const [query, setQuery] = signal('');
  const listed = listedTasks(entry);
  const found = computed(() => matches(listed, query()));
  const searching = () => query().trim() !== '';
  return VStack({ spacing: 10 }, [
    searchField('Search tasks…', setQuery),
    ForEach({ items: () => (searching() ? ['results'] : []), key: (name) => name }, () =>
      VStack({ spacing: 1 }, [
        ForEach({ items: found, key: (item) => item.task.id }, (item) => taskRow(item().task, item().color)),
        Text(() => (found().length ? '' : 'No matching tasks.'))
          .font(11)
          .color('tertiary')
          .paddingHorizontal(4)
      ])
    ),
    ForEach({ items: () => (searching() ? [] : ['browse']), key: (name) => name }, () =>
      VStack({ spacing: 10 }, [
        tasksCard(entry, listed),
        ...STATES.flatMap(({ title, holds }) => {
          const projects = entry.projects.filter(holds);
          return projects.length ? [stateGroup(title, projects)] : [];
        }),
        ...(entry.projects.length ? [] : [note('No projects yet.')])
      ])
    )
  ]);
};

export interface ProjectsOptions {
  tabs: View;
  home: () => string | undefined;
  homes: readonly string[];
  pick: (home: string) => void;
}

/**
 * The scoped agent's work: a search over its tasks, every task at a glance, then its projects by state. The top
 * row's icons open its dashboard and roadmap as full tabs.
 */
export const projectsPage = ({ tabs, home, homes, pick }: ProjectsOptions) => {
  return VStack({ spacing: 8 }, [
    HStack({ spacing: 2 }, [
      tabs,
      Spacer({ minLength: 4 }),
      ForEach(
        { items: () => [entryOf(home())].filter((item) => item !== undefined), key: (item) => item.dashboard },
        (item) => {
          const { dashboard, roadmap } = item();
          return HStack({ spacing: 2 }, [
            toolIcon('square.grid.3x3', 'Dashboard', () => cmux('browser.tab.new', { url: `${dashboard}#today` })),
            ...(roadmap ? [toolIcon('map', 'Roadmap', () => cmux('browser.tab.new', { url: roadmap }))] : [])
          ]);
        }
      )
    ]),
    // With more than one agent joined, a chip per agent, lit for the one the workspace picked.
    ...(homes.length > 1
      ? [
          HStack({ spacing: 4 }, [
            ...homes.map((path) =>
              chip(
                homeLabel(path),
                () => home() === path,
                () => pick(path)
              )
            ),
            Spacer({ minLength: 0 })
          ])
        ]
      : []),
    scopedPage(home, projectsBody)
  ]).paddingHorizontal(6);
};
