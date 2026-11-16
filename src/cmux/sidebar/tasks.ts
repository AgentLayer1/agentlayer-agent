import type { TaskItem } from './data';
import { dueLabel, isoDay, type DueLabel } from './due';
import { GREEN, GREY, listRow, ORANGE, pill, RED, TITLE_OPACITY, type ProjectTag } from './style';

const OPEN = { symbol: 'circle', color: GREY };
const STATUS: Readonly<Record<string, { symbol: string; color: string }>> = {
  active: { symbol: 'circle.fill', color: GREEN },
  blocked: { symbol: 'exclamationmark.circle.fill', color: RED },
  open: OPEN
};
const statusOf = (status: string) => STATUS[status] ?? OPEN;

const TONE: Readonly<Record<DueLabel['tone'], string>> = { overdue: RED, soon: ORANGE, later: 'tertiary' };
const URGENT = new Set(['P0', 'P1']);

// The due words only change at midnight, so the label follows a day, not the per-second clock.
export const today = computed(() => isoDay(data.clock()?.epoch ?? Date.now() / 1000));

const statusIcon = (status: string, size = 7) => {
  const { symbol, color } = statusOf(status);
  return Image(symbol).font(size).color(color);
};

/**
 * A status count: its icon and number, or nothing at zero.
 */
export const count = (amount: number, status: string) =>
  amount
    ? [
        HStack({ spacing: 3 }, [
          statusIcon(status, 6),
          Text(String(amount)).font(10).weight('medium').monospaced().color('secondary')
        ]).fixedSize()
      ]
    : [];

const taskMeta = (task: TaskItem, project?: ProjectTag) =>
  HStack({ spacing: 6 }, [
    statusIcon(task.status),
    Text(task.id).font(10).monospaced().color('tertiary'),
    Text(task.priority)
      .font(10)
      .weight('semibold')
      .monospaced()
      .color(URGENT.has(task.priority) ? ORANGE : 'tertiary'),
    Text(() => dueLabel(task.due, today())?.text ?? '')
      .font(10)
      .color(() => TONE[dueLabel(task.due, today())?.tone ?? 'later']),
    Spacer({ minLength: 0 }),
    ...(project ? [pill(project.slug, project.color)] : []),
    ...(task.comments
      ? [
          HStack({ spacing: 2 }, [
            Image('bubble.left').font(9).color('tertiary'),
            Text(String(task.comments)).font(10).monospaced().color('tertiary')
          ]).fixedSize()
        ]
      : [])
  ]);

/**
 * A task with its title on up to three lines and its status leading the line below; a tap opens its file as a full
 * tab. `project` names the task's project where tasks from several projects sit together.
 */
export const taskRow = (task: TaskItem, project?: ProjectTag) =>
  listRow(
    VStack({ spacing: 2, alignment: 'leading' }, [
      Text(task.title).font(12).opacity(TITLE_OPACITY).lineLimit(3).truncation('tail'),
      taskMeta(task, project)
    ])
  ).onTap(() => cmux('file.open', { path: task.path }));
