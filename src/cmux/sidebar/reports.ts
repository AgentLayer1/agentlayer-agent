import { searchField } from 'cmux-custom-manager/components';
import { daysUntil } from '../../work/due';
import type { HomeEntry, PinItem, ReportItem } from './data';
import { CARD, groupTitle, hueColor, note } from './style';
import { today } from './tasks';
import { openTarget, targetKey } from './view';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Today and Yesterday by name, then the weekday and date, worded against the sidebar's day so it turns at midnight.
const dayTitle = (date: string, day: string): string => {
  const days = daysUntil(date, day);
  if (days === 0) {
    return 'Today';
  }
  if (days === -1) {
    return 'Yesterday';
  }
  const [year, month, dayOfMonth] = date.split('-').map(Number);
  if (!year || !month || !dayOfMonth) {
    return date || 'Undated';
  }
  const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
  return `${WEEKDAYS[weekday] ?? ''} ${dayOfMonth} ${MONTHS[month - 1] ?? ''}`;
};

interface Pinned {
  pin: PinItem;
  /**
   * The project a pin came from, with its colour; absent for the home's own pins.
   */
  project?: { slug: string; color: string };
}

interface DayGroup {
  date: string;
  reports: ReportItem[];
}

const tile = (view: View, onTap: () => void) =>
  view
    .paddingHorizontal(8)
    .paddingVertical(6)
    .background(CARD)
    .cornerRadius(8)
    .hoverBackground('#7f7f7f26')
    .cursor('pointer')
    .frame({ maxWidth: 'infinity', alignment: 'leading' })
    .onTap(onTap);

const badge = (label: string, color: string) =>
  HStack({ spacing: 4 }, [
    Circle({ size: 6 }).fill(color),
    Text(label).font(10).color('secondary').lineLimit(1).truncation('tail')
  ]).fixedSize('horizontal');

const reportCard = (item: ReportItem) =>
  tile(
    VStack({ spacing: 3, alignment: 'leading' }, [
      Text(item.title).font(12).lineLimit(2).truncation('tail'),
      HStack({ spacing: 6 }, [
        badge(item.kind, hueColor(item.hue)),
        Text(item.time).font(10).monospaced().color('tertiary'),
        ...(item.status ? [Text(item.status).font(9)] : []),
        Spacer({ minLength: 0 })
      ])
    ]),
    () => openTarget(item.target)
  );

const pinCard = ({ pin, project }: Pinned) =>
  tile(
    HStack({ spacing: 6 }, [
      Text(pin.icon).font(11).frame({ width: 14 }),
      Text(pin.title).font(12).lineLimit(2).truncation('tail'),
      Spacer({ minLength: 4 }),
      ...(project ? [badge(project.slug, project.color)] : [])
    ]),
    () => openTarget(pin.target)
  );

const matches = (query: string, ...texts: string[]): boolean => {
  const haystack = texts.join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
};

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
    pinned.filter(({ pin, project }) => matches(query(), pin.title, project?.slug ?? ''))
  );
  const days = computed(() => byDay(entry.reports.filter((report) => matches(query(), report.title, report.kind))));
  const empty = computed(() => !shownPins().length && !days().length);
  return VStack({ spacing: 10 }, [
    searchField('Search reports…', setQuery),
    ForEach({ items: () => (shownPins().length ? ['pinned'] : []), key: (name) => name }, () =>
      VStack({ spacing: 4 }, [
        groupTitle('Pinned', shownPins().length),
        ForEach({ items: shownPins, key: (item) => targetKey(item.pin.target) }, (item) => pinCard(item()))
      ])
    ),
    ForEach({ items: days, key: (group) => group.date }, (group) =>
      VStack({ spacing: 4 }, [
        HStack({ spacing: 4 }, [
          Text(() => dayTitle(group().date, today()).toUpperCase())
            .font(10)
            .weight('semibold')
            .color('tertiary'),
          Text(() => String(group().reports.length))
            .font(10)
            .monospaced()
            .color('quaternary'),
          Spacer({ minLength: 0 })
        ]).paddingHorizontal(4),
        ForEach({ items: () => group().reports, key: (report) => targetKey(report.target) }, (report) =>
          reportCard(report())
        )
      ])
    ),
    Text(() => (empty() ? (query().trim() ? 'No matching reports.' : 'No reports yet.') : ''))
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
