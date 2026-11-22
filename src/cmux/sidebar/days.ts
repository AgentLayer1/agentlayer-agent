import { daysUntil, shortDate } from '../../work/due';
import type { PinTarget } from './data';
import { ACCENT, dividedList, foldCard, hueColor, keepWidth, listRow, TITLE_OPACITY } from './style';
import { today } from './tasks';
import { openTarget, targetKey } from './view';

// 24-hour `HH:MM` as the entry writes it, shown as `8:30 AM`.
const clock = (time: string): string => {
  const [hour, minute] = time.split(':').map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    return time;
  }
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
};

/**
 * Today and Yesterday by name, then the weekday and date, worded against the sidebar's day so it turns at midnight.
 */
const dayTitle = (date: string, day: string): string => {
  const days = daysUntil(date, day);
  if (days === 0) {
    return 'Today';
  }
  if (days === -1) {
    return 'Yesterday';
  }
  return shortDate(date, { weekday: true }) ?? (date || 'Undated');
};

interface DayGroup<Item> {
  date: string;
  items: Item[];
}

/**
 * Items already newest first, in a group per day.
 */
export const byDay = <Item extends { date: string }>(items: readonly Item[]): DayGroup<Item>[] =>
  items.reduce<DayGroup<Item>[]>((groups, item) => {
    const last = groups.at(-1);
    return last && last.date === item.date
      ? [...groups.slice(0, -1), { date: last.date, items: [...last.items, item] }]
      : [...groups, { date: item.date, items: [item] }];
  }, []);

interface Dated {
  title: string;
  kind: string;
  hue: number;
  time: string;
  target: PinTarget;
}

/**
 * A row in a day's card: the title, then its kind's dot and name, any `extras`, and the time; a tap opens it.
 */
export const datedRow = (item: Dated, extras: View[] = []) =>
  listRow(
    VStack({ spacing: 3, alignment: 'leading' }, [
      Text(item.title).font(12).opacity(TITLE_OPACITY).lineLimit(2).truncation('tail'),
      HStack({ spacing: 6 }, [
        HStack({ spacing: 4 }, [
          Circle({ size: 6 }).fill(hueColor(item.hue)),
          Text(item.kind).font(10).color('secondary').lineLimit(1).truncation('tail')
        ]).fixedSize('horizontal'),
        ...extras,
        Spacer({ minLength: 0 }),
        keepWidth(Text(clock(item.time)).font(10).monospaced().color('tertiary'))
      ])
    ])
  ).onTap(() => openTarget(item.target));

/**
 * A folding card per day, today and yesterday open and earlier days folded; a search opens every one.
 */
export const dayCards = <Item extends { date: string; target: PinTarget }>(
  groups: () => DayGroup<Item>[],
  searching: () => boolean,
  row: (item: Item) => View
) =>
  ForEach({ items: groups, key: (group) => group.date }, (group) => {
    const age = daysUntil(group().date, today());
    const [open, setOpen] = signal(age !== null && age >= -1);
    return foldCard(
      {
        title: () => dayTitle(group().date, today()),
        count: () => group().items.length,
        icon: 'calendar',
        color: ACCENT,
        expanded: () => open() || searching(),
        setExpanded: setOpen
      },
      () =>
        dividedList(
          () => group().items,
          (item) => targetKey(item.target),
          row
        )
    );
  });
