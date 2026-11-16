import { SCHEMA, type HomeEntry } from './data';
import { note } from './style';

interface Scoped {
  path: string;
  entry: HomeEntry;
  current: boolean;
}

/**
 * A joined home as its chips and headers name it.
 */
export const homeLabel = (home: string): string => {
  const entry = DATA.homes[home];
  return entry ? `${entry.emoji} ${entry.name}`.trim() : home;
};

/**
 * A page about the scoped agent: `ready` draws it, an entry from an older plugin asks for an update instead,
 * and a sidebar no agent has joined says how to join.
 */
export const scopedPage = (home: () => string | undefined, ready: (path: string, entry: HomeEntry) => View) => {
  const view = computed((): Scoped | null => {
    const path = home();
    const entry = path ? DATA.homes[path] : undefined;
    return path && entry ? { path, entry, current: entry.schema === SCHEMA } : null;
  });
  const showing = (current: boolean) => () => [view()].filter((item): item is Scoped => item?.current === current);
  return VStack({ spacing: 0 }, [
    ForEach({ items: showing(true), key: (item) => item.path }, (item) => ready(item().path, item().entry)),
    ForEach({ items: showing(false), key: (item) => item.path }, (item) =>
      note(`${homeLabel(item().path)} needs its agent updated to show here.`)
    ),
    ForEach({ items: () => (view() ? [] : ['none']), key: (item) => item }, () =>
      note('No agent has joined this sidebar yet. In an agent’s home, run its cmux sidebar install.')
    )
  ]);
};
