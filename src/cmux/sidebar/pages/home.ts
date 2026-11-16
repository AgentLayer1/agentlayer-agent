import { cardRow } from 'cmux-custom-dashboard/components';
import { agentCards, type Card } from 'cmux-custom-dashboard/model';
import { SCHEMA, type HomeEntry, type Link } from '../data';
import { homeOf } from '../scope';
import { hueColor, label, note, open, row, symbol } from '../style';

interface Scoped {
  path: string;
  entry: HomeEntry;
}

interface PageLink extends Link {
  symbolName: string;
}

const newestFirst = (first: Card, second: Card) =>
  (second.agent.lastActivityAt ?? 0) - (first.agent.lastActivityAt ?? 0);

// The entry never changes while the sidebar is loaded (a new one arrives as a rewrite), so plain conditionals
// decide what each home's page holds; only the sessions are live.
const body = ({ path, entry }: Scoped, homes: readonly string[]) => {
  const needs = computed(() =>
    agentCards()
      .filter((card) => card.section === 'needs' && homeOf(homes, card.agent.directory) === path)
      .toSorted(newestFirst)
  );
  const roadmap: PageLink[] = entry.roadmap
    ? [{ title: 'Roadmap', kind: 'html', target: entry.roadmap, symbolName: 'map' }]
    : [];
  const pages: PageLink[] = [
    { title: 'Today', kind: 'html', target: `${entry.dashboard}#today`, symbolName: 'sun.max' },
    { title: 'Tasks', kind: 'html', target: `${entry.dashboard}#tasks`, symbolName: 'checklist' },
    ...roadmap
  ];
  return VStack({ spacing: 2 }, [
    HStack({ spacing: 8 }, [Text(entry.emoji).font(18), Text(entry.name).font(15).weight('semibold'), Spacer()])
      .paddingHorizontal(10)
      .paddingBottom(4),
    label('NEEDS YOU', () => needs().length),
    VStack({ spacing: 4 }, [ForEach({ items: needs, key: (card) => card.key }, cardRow)]),
    ForEach({ items: () => (needs().length ? [] : ['calm']), key: (item) => item }, () => note('Nothing needs you.')),
    label('OPEN'),
    ...pages.map((link) => row(symbol(link.symbolName), link.title, 'arrow.up.right', () => open(link))),
    ...(entry.projects.length
      ? [
          label('PROJECTS'),
          ...entry.projects.map((project) =>
            row(
              Circle({ size: 8 }).fill(hueColor(project.hue)).frame({ width: 16 }),
              project.slug,
              'chevron.right',
              () => open({ kind: 'md', target: project.readme })
            )
          )
        ]
      : []),
    ...(entry.pinned.length
      ? [
          label('PINNED'),
          ...entry.pinned.map((link) =>
            row(symbol(link.kind === 'md' ? 'doc.text' : 'globe'), link.title, 'arrow.up.right', () => open(link))
          )
        ]
      : [])
  ]);
};

/**
 * The scoped agent's page: who needs you, the dashboard's pages, its projects and its pins.
 */
export const homePage = (home: () => string | undefined, homes: readonly string[]) => {
  const scoped = computed((): Scoped | null => {
    const path = home();
    const entry = path ? DATA.homes[path] : undefined;
    return path && entry ? { path, entry } : null;
  });
  return VStack({ spacing: 0 }, [
    ForEach(
      {
        items: () => [scoped()].filter((item): item is Scoped => item?.entry.schema === SCHEMA),
        key: (item) => item.path
      },
      (item) => body(item(), homes)
    ),
    ForEach(
      {
        items: () => [scoped()].filter((item): item is Scoped => item !== null && item.entry.schema !== SCHEMA),
        key: (item) => `update:${item.path}`
      },
      (item) => note(`${item().entry.emoji} ${item().entry.name} needs its agent updated to show here.`)
    ),
    ForEach({ items: () => (scoped() ? [] : ['empty']), key: (item) => item }, () =>
      note('No agent has joined this sidebar yet. In an agent’s home, run its cmux sidebar install.')
    )
  ]);
};
