import type { HomeEntry, ProjectCard, TaskItem } from '../data';
import { dueLabel, isoDay, type DueLabel } from '../due';
import { hueColor, note } from '../style';
import { homeLabel, scopedPage } from '../view';

const STATUS: Readonly<Record<string, { symbol: string; color: string }>> = {
  active: { symbol: 'circle.inset.filled', color: '#34C759' },
  blocked: { symbol: 'exclamationmark.circle.fill', color: '#FF453A' },
  open: { symbol: 'circle', color: '#8E8E93' }
};
const statusOf = (status: string) => STATUS[status] ?? { symbol: 'circle', color: '#8E8E93' };

const TONE: Readonly<Record<DueLabel['tone'], string>> = { overdue: '#FF453A', soon: '#FF9F0A', later: 'tertiary' };
const URGENT = new Set(['P0', 'P1']);

// The due words only change at midnight, so the label follows a day, not the per-second clock.
const today = computed(() => isoDay(data.clock()?.epoch ?? Date.now() / 1000));

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

const count = (value: number, symbol: string, color: string) =>
  value
    ? [
        HStack({ spacing: 2 }, [
          Image(symbol).font(8).color(color),
          Text(String(value)).font(10).weight('semibold').monospaced().color('secondary')
        ]).fixedSize()
      ]
    : [];

// The task's id, priority and due date, with the due words read live against today.
const taskMeta = (task: TaskItem) =>
  HStack({ spacing: 6 }, [
    Text(task.id).font(10).monospaced().color('tertiary'),
    Text(task.priority)
      .font(10)
      .weight('semibold')
      .monospaced()
      .color(URGENT.has(task.priority) ? '#FF9F0A' : 'tertiary'),
    Text(() => dueLabel(task.due, today())?.text ?? '')
      .font(10)
      .color(() => TONE[dueLabel(task.due, today())?.tone ?? 'later']),
    Spacer({ minLength: 0 })
  ]);

const taskRow = (item: () => TaskItem) => {
  const task = item();
  const { symbol, color } = statusOf(task.status);
  return HStack({ spacing: 7 }, [
    Image(symbol).font(10).color(color).frame({ width: 14 }),
    VStack({ spacing: 1, alignment: 'leading' }, [
      Text(task.title).font(12).lineLimit(1).truncation('tail'),
      taskMeta(task)
    ])
  ])
    .paddingHorizontal(8)
    .paddingVertical(5)
    .cornerRadius(8)
    .hoverBackground('#7f7f7f26')
    .cursor('pointer')
    .frame({ maxWidth: 'infinity', alignment: 'leading' })
    .onTap(() => cmux('file.open', { path: task.path }));
};

// The entry is fixed while the sidebar is loaded (an update arrives as a rewrite), so a card reads its project
// once; only whether it's open is live.
const projectCard = (item: () => ProjectCard) => {
  const project = item();
  const [open, setOpen] = signal(false);
  const live = project.active + project.blocked + project.open;
  const total = live + project.done;
  const color = hueColor(project.hue);
  const next = project.tasks[0];
  return VStack({ spacing: 6 }, [
    VStack({ spacing: 6 }, [
      HStack({ spacing: 7 }, [
        Circle({ size: 8 }).fill(color),
        Text(project.slug).font(12).weight('semibold').lineLimit(1).truncation('tail'),
        Spacer({ minLength: 4 }),
        ...count(project.active, 'circle.inset.filled', '#34C759'),
        ...count(project.blocked, 'exclamationmark.circle.fill', '#FF453A'),
        ...count(project.open, 'circle', '#8E8E93'),
        Image(() => (open() ? 'chevron.down' : 'chevron.right'))
          .font(9)
          .weight('semibold')
          .color('tertiary')
      ]),
      ProgressView({ value: total ? project.done / total : 0 }).color(color),
      ForEach({ items: () => (next && !open() ? [next] : []), key: (task) => task.id }, (task) =>
        HStack({ spacing: 6 }, [
          Image(statusOf(task().status).symbol).font(9).color(statusOf(task().status).color),
          Text(task().title).font(11).color('secondary').lineLimit(1).truncation('tail'),
          Spacer({ minLength: 0 })
        ])
      )
    ])
      .cursor('pointer')
      .onTap(() => setOpen(!open())),
    VStack({ spacing: 1 }, [ForEach({ items: () => (open() ? project.tasks : []), key: (task) => task.id }, taskRow)])
  ])
    .paddingHorizontal(10)
    .paddingVertical(8)
    .background('#7f7f7f12')
    .cornerRadius(10)
    .frame({ maxWidth: 'infinity' });
};

const workBody = (entry: HomeEntry) =>
  VStack({ spacing: 6 }, [
    ForEach({ items: entry.projects, key: (project) => project.slug }, projectCard),
    ...(entry.projects.length ? [] : [note('No projects yet.')])
  ]);

export interface WorkOptions {
  tabs: View;
  home: () => string | undefined;
  homes: readonly string[];
  pick: (home: string) => void;
}

/**
 * The scoped agent's work: its dashboard and roadmap as full tabs, then a card per project that opens into its tasks.
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
    ]).paddingHorizontal(10),
    scopedPage(home, (_path, current) => workBody(current))
  ]).paddingHorizontal(6);
};
