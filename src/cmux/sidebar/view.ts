import { SCHEMA, type HomeEntry, type PinTarget } from './data';
import { GREY, hueColor, note, when } from './style';

interface Scoped {
  path: string;
  entry: HomeEntry;
  current: boolean;
}

/**
 * A project's colour by its slug; grey for a slug no project has.
 */
export const projectColors = (entry: HomeEntry) => {
  const colors = new Map(entry.projects.map(({ slug, hue }) => [slug, hueColor(hue)]));
  return (slug: string): string => colors.get(slug) ?? GREY;
};

/**
 * Whether a card starts open: only a preview opens any, through its start page.
 */
export const startsOpen = (card: string): boolean => DATA.open?.expanded?.includes(card) ?? false;

export const openTarget = (target: PinTarget) =>
  target.kind === 'page' ? cmux('browser.tab.new', { url: target.url }) : cmux('file.open', { path: target.path });

// A link's identity is where it goes: two pins may share a title, and cmux drops a repeated list key.
export const targetKey = (target: PinTarget): string => (target.kind === 'page' ? target.url : target.path);

const entryOf = (home: string | undefined): HomeEntry | undefined => (home ? DATA.homes[home] : undefined);

/**
 * Whether `texts` hold every word of `query`, case-insensitively; an empty query matches everything.
 */
export const matchesQuery = (query: string, ...texts: string[]): boolean => {
  const haystack = texts.join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
};

/**
 * A joined home as its chips and headers name it.
 */
export const homeLabel = (home: string): string => {
  const entry = DATA.homes[home];
  return entry ? `${entry.emoji} ${entry.name}`.trim() : home;
};

/**
 * A page about the scoped agent: `ready` draws its entry, an entry from an older plugin asks for an update instead,
 * and a sidebar no agent has joined says how to join.
 */
export const scopedPage = (home: () => string | undefined, ready: (entry: HomeEntry) => View) => {
  const view = computed((): Scoped | null => {
    const path = home();
    const entry = entryOf(path);
    return path && entry ? { path, entry, current: entry.schema === SCHEMA } : null;
  });
  const showing = (current: boolean) => () => [view()].filter((item): item is Scoped => item?.current === current);
  return VStack({ spacing: 0 }, [
    ForEach({ items: showing(true), key: (item) => item.path }, (item) => ready(item().entry)),
    ForEach({ items: showing(false), key: (item) => item.path }, (item) =>
      note(`${homeLabel(item().path)} needs its agent updated to show here.`)
    ),
    when(
      () => view() === null,
      () => note('No agent has joined this sidebar yet. Ask an agent to set up its cmux pack.')
    )
  ]);
};
