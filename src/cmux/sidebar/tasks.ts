import type { TaskItem } from './data';
import { dueLabel, isoDay, type DueLabel } from './due';

const STATUS: Readonly<Record<string, { symbol: string; color: string }>> = {
  active: { symbol: 'circle.inset.filled', color: '#34C759' },
  blocked: { symbol: 'exclamationmark.circle.fill', color: '#FF453A' },
  open: { symbol: 'circle', color: '#8E8E93' }
};
export const statusOf = (status: string) => STATUS[status] ?? { symbol: 'circle', color: '#8E8E93' };

const TONE: Readonly<Record<DueLabel['tone'], string>> = { overdue: '#FF453A', soon: '#FF9F0A', later: 'tertiary' };
const URGENT = new Set(['P0', 'P1']);

// The due words only change at midnight, so the label follows a day, not the per-second clock.
export const today = computed(() => isoDay(data.clock()?.epoch ?? Date.now() / 1000));

/**
 * A status count: its icon and number, or nothing at zero.
 */
export const count = (amount: number, status: string) => {
  const { symbol, color } = statusOf(status);
  return amount
    ? [
        HStack({ spacing: 2 }, [
          Image(symbol).font(8).color(color),
          Text(String(amount)).font(10).weight('semibold').monospaced().color('secondary')
        ]).fixedSize()
      ]
    : [];
};

const taskMeta = (task: TaskItem, projectColor?: string) =>
  HStack({ spacing: 6 }, [
    ...(projectColor ? [Circle({ size: 6 }).fill(projectColor)] : []),
    Text(task.id).font(10).monospaced().color('tertiary'),
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
 * A task with its title on up to three lines; a tap opens its file as a full tab.
 */
export const taskRow = (task: TaskItem, projectColor?: string) => {
  const { symbol, color } = statusOf(task.status);
  return HStack({ spacing: 6, alignment: 'top' }, [
    Image(symbol).font(10).color(color).frame({ width: 12 }).paddingTop(2),
    VStack({ spacing: 2, alignment: 'leading' }, [
      Text(task.title).font(12).lineLimit(3).truncation('tail'),
      taskMeta(task, projectColor)
    ])
  ])
    .paddingLeading(2)
    .paddingTrailing(6)
    .paddingVertical(5)
    .cornerRadius(8)
    .hoverBackground('#7f7f7f26')
    .cursor('pointer')
    .frame({ maxWidth: 'infinity', alignment: 'leading' })
    .onTap(() => cmux('file.open', { path: task.path }));
};
