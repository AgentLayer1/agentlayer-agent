import { searchField } from 'cmux-custom-manager/components';
import type { HomeEntry, PinItem, ReportItem } from './data';
import { byDay, dayCards, datedRow } from './days';
import {
  dividedList,
  foldCard,
  folderButton,
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
import { matchesQuery, openTarget, targetKey } from './view';

interface Pinned {
  pin: PinItem;
  /**
   * The project a pin came from; absent for the home's own pins.
   */
  project?: ProjectTag;
}

const STATUS_COLOR: Readonly<Record<string, string>> = { clean: GREEN, findings: ORANGE, critical: RED, draft: GREY };

const statusBadge = (status: string) => pill(status, STATUS_COLOR[status] ?? GREY);

const reportRow = (item: ReportItem) => datedRow(item, item.status ? [statusBadge(item.status)] : []);

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
  const searching = () => query().trim() !== '';
  const [pinsOpen, setPinsOpen] = signal(true);
  return VStack({ spacing: 10 }, [
    HStack({ spacing: 4 }, [searchField('Search reports…', setQuery), ...folderButton(entry.folders?.reports)]),
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
              expanded: () => pinsOpen() || searching(),
              setExpanded: setPinsOpen
            },
            () => dividedList(shownPins, (item) => targetKey(item.pin.target), pinRow)
          )
      ),
      dayCards(days, searching, reportRow)
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
