import { SCHEMA, type HomeEntry } from './data';
import { note } from './style';

interface Scoped {
  path: string;
  entry: HomeEntry;
  current: boolean;
}

export const entryOf = (home: string | undefined): HomeEntry | undefined => (home ? DATA.homes[home] : undefined);

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
    ForEach({ items: () => (view() ? [] : ['none']), key: (item) => item }, () =>
      note('No agent has joined this sidebar yet. Ask an agent to set up its cmux pack.')
    )
  ]);
};
