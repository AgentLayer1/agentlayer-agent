import { cardRow } from 'cmux-custom-manager/components';
import type { HomeEntry, Link } from '../data';
import { needsIn } from '../cards';
import { hueColor, label, note, open, row, symbol } from '../style';
import { scopedPage } from '../view';

interface PageLink extends Link {
  symbolName: string;
}

// The entry never changes while the sidebar is loaded (a new one arrives as a rewrite), so plain conditionals
// decide what each home's page holds; only the sessions are live.
const body = (path: string, entry: HomeEntry, homes: readonly string[]) => {
  const needs = computed(() => needsIn(homes, path));
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
export const homePage = (home: () => string | undefined, homes: readonly string[]) =>
  scopedPage(home, (path, entry) => body(path, entry, homes));
