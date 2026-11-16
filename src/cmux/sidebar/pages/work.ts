import type { HomeEntry, PinItem, PinTarget, ProjectCard, TaskItem } from '../data';
import { BUCKETS, dueBucket, dueLabel, type DueBucket } from '../due';
import { groupTitle, hueColor, note, progressBar } from '../style';
import { count, statusOf, taskRow, today } from '../tasks';
import { homeLabel, scopedPage } from '../view';

const ACCENT = '#0A84FF';
const CARD = '#7f7f7f12';

const open = (target: PinTarget) =>
  target.kind === 'page' ? cmux('browser.tab.new', { url: target.url }) : cmux('file.open', { path: target.path });

const pageChip = (symbol: string, title: string, url: string) =>
  HStack({ spacing: 4 }, [Image(symbol).font(10).color('secondary'), Text(title).font(11).weight('medium')])
    .paddingHorizontal(8)
    .paddingVertical(4)
    .background('#7f7f7f1f')
    .cornerRadius(6)
    .hoverBackground('#7f7f7f3d')
    .cursor('pointer')
    .fixedSize('horizontal')
    .onTap(() => cmux('browser.tab.new', { url }));

const linkRow = ({ icon, title, target }: PinItem) =>
  HStack({ spacing: 6 }, [
    Text(icon).font(11).frame({ width: 14 }),
    Text(title).font(11).color('secondary').lineLimit(1).truncation('tail'),
    Spacer({ minLength: 0 })
  ])
    .paddingLeading(2)
    .paddingVertical(3)
    .cornerRadius(6)
    .hoverBackground('#7f7f7f26')
    .cursor('pointer')
    .onTap(() => open(target));

const roadmapLink = (url: string): PinItem => ({ title: 'Roadmap', icon: '🗺️', target: { kind: 'page', url } });

const chevron = (open: () => boolean) =>
  Image(() => (open() ? 'chevron.down' : 'chevron.right'))
    .font(9)
    .weight('semibold')
    .color('tertiary');

const card = (view: View) => view.paddingHorizontal(10).paddingVertical(8).background(CARD).cornerRadius(10);

const fraction = (done: number, live: number) => (done + live ? done / (done + live) : 0);

const AGENDA: Readonly<Record<DueBucket, string>> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  month: 'This month',
  later: 'Later',
  someday: 'Someday'
};

interface Listed {
  task: TaskItem;
  color: string;
}

interface AgendaGroup {
  title: string;
  tasks: Listed[];
}

// In flight leads and carries its own due words, so each task shows once, as on the dashboard's Tasks page.
const agenda = (listed: readonly Listed[], day: string): AgendaGroup[] => {
  const waiting = listed.filter(({ task }) => task.status !== 'active');
  return [
    { title: 'In flight', tasks: listed.filter(({ task }) => task.status === 'active') },
    ...BUCKETS.map((bucket) => ({
      title: AGENDA[bucket],
      tasks: waiting.filter(({ task }) => dueBucket(task.due, day) === bucket)
    }))
  ].filter((group) => group.tasks.length);
};

const dueTally = (amount: () => number, label: string, color: string) =>
  Text(() => (amount() ? `${amount()} ${label}` : ''))
    .font(10)
    .weight('semibold')
    .color(color);

const tasksCard = (entry: HomeEntry) => {
  const [expanded, setExpanded] = signal(false);
  const listed = entry.projects.flatMap((project) =>
    project.tasks.map((task) => ({ task, color: hueColor(project.hue) }))
  );
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
          groupTitle(group().title, group().tasks.length).paddingHorizontal(0).paddingTop(4),
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
          HStack({ spacing: 6 }, [
            Image(statusOf(task().status).symbol).font(9).color(statusOf(task().status).color),
            Text(task().title).font(11).color('secondary').lineLimit(1).truncation('tail'),
            Spacer({ minLength: 0 })
          ])
        )
      ])
        .cursor('pointer')
        .onTap(() => setExpanded(!expanded())),
      ForEach({ items: () => (expanded() ? links : []), key: (link) => link.title }, (link) => linkRow(link())),
      VStack({ spacing: 1 }, [
        ForEach({ items: () => (expanded() ? project.tasks : []), key: (task) => task.id }, (task) => taskRow(task()))
      ])
    ])
  ).frame({ maxWidth: 'infinity' });
};

const STATES = [
  { title: 'At work', holds: (project: ProjectCard) => project.active > 0 },
  { title: 'Blocked', holds: (project: ProjectCard) => !project.active && project.blocked > 0 },
  { title: 'Quiet', holds: (project: ProjectCard) => !project.active && !project.blocked }
];

const projectsSection = (projects: readonly ProjectCard[]) => {
  const [expanded, setExpanded] = signal(true);
  const groups = STATES.map(({ title, holds }) => ({ title, projects: projects.filter(holds) })).filter(
    (group) => group.projects.length
  );
  return VStack({ spacing: 6 }, [
    HStack({ spacing: 4 }, [
      Text('PROJECTS').font(10).weight('semibold').color('secondary'),
      Text(String(projects.length)).font(10).monospaced().color('tertiary'),
      Spacer({ minLength: 0 }),
      chevron(expanded)
    ])
      .paddingHorizontal(4)
      .cursor('pointer')
      .onTap(() => setExpanded(!expanded())),
    ForEach({ items: () => (expanded() ? groups : []), key: (group) => group.title }, (group) =>
      VStack({ spacing: 6 }, [
        groupTitle(group().title, group().projects.length),
        ForEach({ items: group().projects, key: (project) => project.slug }, projectCard)
      ])
    )
  ]);
};

const workBody = (entry: HomeEntry) =>
  VStack({ spacing: 10 }, [
    tasksCard(entry),
    ...(entry.projects.length ? [projectsSection(entry.projects)] : [note('No projects yet.')])
  ]);

export interface WorkOptions {
  tabs: View;
  home: () => string | undefined;
  homes: readonly string[];
  pick: (home: string) => void;
}

/**
 * The scoped agent's work: its dashboard and roadmap as full tabs, every task at a glance, then its projects.
 */
export const workPage = ({ tabs, home, homes, pick }: WorkOptions) => {
  const entry = () => {
    const path = home();
    return path ? DATA.homes[path] : undefined;
  };
  return VStack({ spacing: 8 }, [
    HStack({ spacing: 6 }, [
      tabs,
      ForEach({ items: () => (entry() ? [home() ?? ''] : []), key: (path) => path }, (path) => {
        const current = DATA.homes[path()];
        return HStack({ spacing: 6 }, [
          ...(current ? [pageChip('square.grid.3x3', 'Dashboard', `${current.dashboard}#today`)] : []),
          ...(current?.roadmap ? [pageChip('map', 'Roadmap', current.roadmap)] : [])
        ]);
      }),
      Spacer({ minLength: 0 }),
      ...(homes.length > 1
        ? [
            Menu(
              () => homeLabel(home() ?? ''),
              homes.map((path) => Button(homeLabel(path), () => pick(path)))
            )
          ]
        : [])
    ]).paddingHorizontal(4),
    scopedPage(home, (_path, current) => workBody(current))
  ]).paddingHorizontal(6);
};
