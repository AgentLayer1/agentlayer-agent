import { searchField } from 'cmux-custom-manager/components';
import type { HomeEntry, PinItem, ProjectCard, TaskItem } from './data';
import { BUCKETS, dueBucket, type DueBucket } from '../../work/due';
import { dueLabel } from './due';
import {
  ACCENT,
  chevron,
  dividedList,
  foldingCard,
  foldTitle,
  groupTitle,
  hueColor,
  keepWidth,
  note,
  ORANGE,
  progressBar,
  RED,
  when
} from './style';
import { count, taskRow, today } from './tasks';
import { matchesQuery, openTarget, projectColors, startsOpen, targetKey } from './view';

const linkRow = ({ icon, title, target }: PinItem) =>
  HStack({ spacing: 6 }, [
    Text(icon).font(11).frame({ width: 14 }),
    Text(title)
      .font(11)
      .color('secondary')
      .lineLimit(1)
      .truncation('tail')
      .frame({ maxWidth: 'infinity', alignment: 'leading' })
  ])
    .paddingHorizontal(4)
    .paddingVertical(2)
    .cornerRadius(6)
    .hoverBackground('#7f7f7f26')
    .cursor('pointer')
    .onTap(() => openTarget(target));

const roadmapLink = (url: string): PinItem => ({ title: 'Roadmap', icon: '🗺️', target: { kind: 'page', url } });

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

const listedTasks = (entry: HomeEntry): Listed[] => {
  const colorOf = projectColors(entry);
  return entry.tasks.map((task) => ({ task, color: colorOf(task.project) }));
};

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
  keepWidth(
    Text(() => (amount() ? `${amount()} ${label}` : ''))
      .font(10)
      .weight('semibold')
      .color(color)
  );

const tasksCard = (entry: HomeEntry, listed: readonly Listed[]) => {
  const [expanded, setExpanded] = signal(startsOpen('tasks'));
  const total = (field: 'active' | 'blocked' | 'open' | 'done') =>
    entry.projects.reduce((sum, project) => sum + project[field], 0);
  const tone = (wanted: string) => () =>
    listed.filter(({ task }) => dueLabel(task.due, today())?.tone === wanted).length;
  const groups = computed(() => agenda(listed, today()));
  return foldingCard(
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
        dueTally(tone('overdue'), 'overdue', RED),
        dueTally(tone('soon'), 'due this week', ORANGE),
        Spacer({ minLength: 0 })
      ])
    ]),
    expanded,
    setExpanded,
    () =>
      VStack({ spacing: 6 }, [
        ForEach({ items: groups, key: (group) => group.title }, (group) =>
          VStack({ spacing: 1 }, [
            groupTitle(group().title, group().tasks.length).paddingTop(4),
            dividedList(
              () => group().tasks,
              (item) => item.task.id,
              (item) => taskRow(item.task, item.color)
            )
          ])
        )
      ])
  );
};

// The entry is fixed while the sidebar is loaded (an update arrives as a rewrite), so a card takes its project and
// tasks once; only whether it's open is live.
const projectCard = (project: ProjectCard, tasks: TaskItem[]) => {
  const [expanded, setExpanded] = signal(startsOpen(project.slug));
  const color = hueColor(project.hue);
  const next = tasks[0];
  const links = [...(project.roadmap ? [roadmapLink(project.roadmap)] : []), ...project.pins];
  return foldingCard(
    VStack({ spacing: 6 }, [
      HStack({ spacing: 7 }, [
        Circle({ size: 8 }).fill(color),
        Text(project.slug)
          .font(12)
          .weight('semibold')
          .lineLimit(1)
          .truncation('tail')
          .frame({ maxWidth: 'infinity', alignment: 'leading' }),
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
          Text(task().title)
            .font(11)
            .color('secondary')
            .lineLimit(1)
            .truncation('tail')
            .frame({ maxWidth: 'infinity', alignment: 'leading' })
        ])
      )
    ]),
    expanded,
    setExpanded,
    () =>
      VStack({ spacing: 6 }, [
        ...(links.length
          ? [
              VStack({ spacing: 0 }, [
                ForEach({ items: links, key: (link) => targetKey(link.target) }, (link) => linkRow(link()))
              ])
            ]
          : []),
        dividedList(
          () => tasks,
          (task) => task.id,
          (task) => taskRow(task)
        )
      ])
  );
};

const STATES = [
  { title: 'At work', holds: (project: ProjectCard) => project.active > 0 },
  { title: 'Blocked', holds: (project: ProjectCard) => !project.active && project.blocked > 0 },
  { title: 'Quiet', holds: (project: ProjectCard) => !project.active && !project.blocked }
];

const stateGroup = (title: string, projects: ProjectCard[], tasksOf: ReadonlyMap<string, TaskItem[]>) => {
  const [expanded, setExpanded] = signal(true);
  return VStack({ spacing: 6 }, [
    foldTitle(title, projects.length, expanded, setExpanded),
    ForEach({ items: () => (expanded() ? projects : []), key: (project) => project.slug }, (item) =>
      projectCard(item(), tasksOf.get(item().slug) ?? [])
    )
  ]);
};

/**
 * The scoped agent's work: a search over its tasks, every task at a glance, then its projects by state.
 */
export const projectsBody = (entry: HomeEntry) => {
  const [query, setQuery] = signal('');
  const listed = listedTasks(entry);
  const tasksOf = entry.tasks.reduce(
    (byProject, task) => byProject.set(task.project, [...(byProject.get(task.project) ?? []), task]),
    new Map<string, TaskItem[]>()
  );
  const found = computed(() => listed.filter(({ task }) => matchesQuery(query(), task.title, task.id)));
  const searching = () => query().trim() !== '';
  return VStack({ spacing: 10 }, [
    searchField('Search tasks…', setQuery),
    when(searching, () =>
      VStack({ spacing: 1 }, [
        dividedList(
          found,
          (item) => item.task.id,
          (item) => taskRow(item.task, item.color)
        ),
        Text(() => (found().length ? '' : 'No matching tasks.'))
          .font(11)
          .color('tertiary')
          .paddingHorizontal(4)
      ])
    ),
    when(
      () => !searching(),
      () =>
        VStack({ spacing: 10 }, [
          tasksCard(entry, listed),
          ...STATES.flatMap(({ title, holds }) => {
            const projects = entry.projects.filter(holds);
            return projects.length ? [stateGroup(title, projects, tasksOf)] : [];
          }),
          ...(entry.projects.length ? [] : [note('No projects yet.')])
        ])
    )
  ]);
};
