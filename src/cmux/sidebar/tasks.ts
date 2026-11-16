import type { TaskItem } from './data';
import { dueLabel, isoDay, type DueLabel } from './due';

const STATUS: Readonly<Record<string, { symbol: string; color: string }>> = {
  active: { symbol: 'circle.fill', color: '#34C759' },
  blocked: { symbol: 'exclamationmark.circle.fill', color: '#FF453A' },
  open: { symbol: 'circle', color: '#8E8E93' }
};
export const statusOf = (status: string) => STATUS[status] ?? { symbol: 'circle', color: '#8E8E93' };

const TONE: Readonly<Record<DueLabel['tone'], string>> = { overdue: '#FF453A', soon: '#FF9F0A', later: 'tertiary' };
const URGENT = new Set(['P0', 'P1']);

// The due words only change at midnight, so the label follows a day, not the per-second clock.
export const today = computed(() => isoDay(data.clock()?.epoch ?? Date.now() / 1000));

export const statusIcon = (status: string, size = 7) =>
  Image(statusOf(status).symbol).font(size).color(statusOf(status).color);

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

// The id takes the project's colour where tasks from several projects sit together.
const taskMeta = (task: TaskItem, projectColor?: string) =>
  HStack({ spacing: 6 }, [
    statusIcon(task.status),
    Text(task.id)
      .font(10)
      .monospaced()
      .color(projectColor ?? 'tertiary'),
    Text(task.priority)
      .font(10)
      .weight('semibold')
      .monospaced()
      .color(URGENT.has(task.priority) ? '#FF9F0A' : 'tertiary'),
    Text(() => dueLabel(task.due, today())?.text ?? '')
      .font(10)
      .color(() => TONE[dueLabel(task.due, today())?.tone ?? 'later']),
    Spacer({ minLength: 0 }),
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
 * tab.
 */
export const taskRow = (task: TaskItem, projectColor?: string) =>
  VStack({ spacing: 2, alignment: 'leading' }, [
    Text(task.title).font(12).lineLimit(3).truncation('tail'),
    taskMeta(task, projectColor)
  ])
    .paddingHorizontal(4)
    .paddingVertical(5)
    .cornerRadius(8)
    .hoverBackground('#7f7f7f26')
    .cursor('pointer')
    .frame({ maxWidth: 'infinity', alignment: 'leading' })
    .onTap(() => cmux('file.open', { path: task.path }));
