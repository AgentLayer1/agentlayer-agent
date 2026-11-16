import { searchField } from 'cmux-custom-manager/components';
import { daysUntil } from '../../work/due';
import type { HomeEntry, PinItem, ReportItem } from './data';
import { dateParts, WEEKDAYS } from './due';
import {
  ACCENT,
  dividedList,
  foldCard,
  GREEN,
  GREY,
  hueColor,
  listRow,
  note,
  ORANGE,
  pill,
  RED,
  TITLE_OPACITY,
  type ProjectTag,
  when
} from './style';
import { today } from './tasks';
import { matchesQuery, openTarget, targetKey } from './view';

// 24-hour `HH:MM` as the index writes it, shown as `8:30 AM`.
const clock = (time: string): string => {
  const [hour, minute] = time.split(':').map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    return time;
  }
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
};

// Today and Yesterday by name, then the weekday and date, worded against the sidebar's day so it turns at midnight.
const dayTitle = (date: string, day: string): string => {
  const days = daysUntil(date, day);
  if (days === 0) {
    return 'Today';
  }
  if (days === -1) {
    return 'Yesterday';
  }
  const parts = dateParts(date);
  return parts ? `${WEEKDAYS[parts.weekday] ?? ''} ${parts.day} ${parts.month}` : date || 'Undated';
};

interface Pinned {
  pin: PinItem;
  /**
   * The project a pin came from; absent for the home's own pins.
   */
  project?: ProjectTag;
}

interface DayGroup {
  date: string;
  reports: ReportItem[];
}

const badge = (label: string, color: string) =>
  HStack({ spacing: 4 }, [
    Circle({ size: 6 }).fill(color),
    Text(label).font(10).color('secondary').lineLimit(1).truncation('tail')
  ]).fixedSize('horizontal');

const STATUS_COLOR: Readonly<Record<string, string>> = { clean: GREEN, findings: ORANGE, critical: RED, draft: GREY };

const statusBadge = (status: string) => pill(status, STATUS_COLOR[status] ?? GREY);

const reportRow = (item: ReportItem) =>
  listRow(
    VStack({ spacing: 3, alignment: 'leading' }, [
      Text(item.title).font(12).opacity(TITLE_OPACITY).lineLimit(2).truncation('tail'),
      HStack({ spacing: 6 }, [
        badge(item.kind, hueColor(item.hue)),
        ...(item.status ? [statusBadge(item.status)] : []),
        Spacer({ minLength: 0 }),
        Text(clock(item.time)).font(10).monospaced().color('tertiary')
      ])
    ])
  ).onTap(() => openTarget(item.target));

const pinRow = ({ pin, project }: Pinned) =>
  listRow(
    HStack({ spacing: 6 }, [
      Text(pin.icon).font(11).frame({ width: 14 }),
      Text(pin.title)
        .font(12)
        .opacity(TITLE_OPACITY)
        .lineLimit(2)
        .truncation('tail')
        .frame({ maxWidth: 'infinity', alignment: 'leading' }),
      ...(project ? [pill(project.slug, project.color)] : [])
    ])
  ).onTap(() => openTarget(pin.target));

const byDay = (reports: readonly ReportItem[]): DayGroup[] =>
  reports.reduce<DayGroup[]>((groups, report) => {
    const last = groups.at(-1);
    return last && last.date === report.date
      ? [...groups.slice(0, -1), { date: last.date, reports: [...last.reports, report] }]
      : [...groups, { date: report.date, reports: [report] }];
  }, []);

/**
 * The scoped agent's reports: a search over titles and kinds, its pins (the home's, then each project's), then the
 * newest reports by day, each opening as a full tab.
 */
export const reportsBody = (entry: HomeEntry) => {
  const [query, setQuery] = signal('');
  const pinned: Pinned[] = [
    ...entry.pins.map((pin) => ({ pin })),
    ...entry.projects.flatMap((project) =>
      project.pins.map((pin) => ({ pin, project: { slug: project.slug, color: hueColor(project.hue) } }))
    )
  ];
  const shownPins = computed(() =>
    pinned.filter(({ pin, project }) => matchesQuery(query(), pin.title, project?.slug ?? ''))
  );
  const days = computed(() =>
    byDay(entry.reports.filter((report) => matchesQuery(query(), report.title, report.kind)))
  );
  const empty = computed(() => !shownPins().length && !days().length);
  // A search shows every match, folded groups included.
  const searching = () => query().trim() !== '';
  const showing = (open: () => boolean) => () => open() || searching();
  const [pinsOpen, setPinsOpen] = signal(true);
  return VStack({ spacing: 10 }, [
    searchField('Search reports…', setQuery),
    VStack({ spacing: 6 }, [
      when(
        () => shownPins().length > 0,
        () =>
          foldCard(
            {
              title: 'Pinned',
              count: () => shownPins().length,
              icon: 'pin.fill',
              color: ORANGE,
              expanded: showing(pinsOpen),
              setExpanded: setPinsOpen
            },
            () => dividedList(shownPins, (item) => targetKey(item.pin.target), pinRow)
          )
      ),
      // Today and yesterday open; earlier days start folded.
      ForEach({ items: days, key: (group) => group.date }, (group) => {
        const age = daysUntil(group().date, today());
        const [open, setOpen] = signal(age !== null && age >= -1);
        return foldCard(
          {
            title: () => dayTitle(group().date, today()),
            count: () => group().reports.length,
            icon: 'calendar',
            color: ACCENT,
            expanded: showing(open),
            setExpanded: setOpen
          },
          () =>
            dividedList(
              () => group().reports,
              (report) => targetKey(report.target),
              reportRow
            )
        );
      })
    ]),
    Text(() => (empty() ? (searching() ? 'No matching reports.' : 'No reports yet.') : ''))
      .font(11)
      .color('tertiary')
      .paddingHorizontal(4),
    ...(entry.olderReports
      ? [
          note(`${entry.olderReports} older reports are on the dashboard.`)
            .cursor('pointer')
            .onTap(() => cmux('browser.tab.new', { url: `${entry.dashboard}#reports` }))
        ]
      : [])
  ]);
};
