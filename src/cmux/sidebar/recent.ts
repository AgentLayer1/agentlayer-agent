import { searchField } from 'cmux-custom-manager/components';
import type { HomeEntry, RecentItem } from './data';
import { byDay, dayCards, datedRow } from './days';
import { folderButton, note, pill } from './style';
import { matchesQuery, projectColors } from './view';

/**
 * The scoped agent's recently changed files, like Finder's Recents: tasks, reports, project pages and knowledge in one
 * list by day, with a search over titles, kinds and projects. Each opens as a full tab.
 */
export const recentBody = (entry: HomeEntry) => {
  const { recent } = entry;
  if (!recent) {
    return note(`Update ${entry.name} to see its recent files.`);
  }
  const colorOf = projectColors(entry);
  const row = (item: RecentItem) => datedRow(item, item.project ? [pill(item.project, colorOf(item.project))] : []);
  const [query, setQuery] = signal('');
  const days = computed(() =>
    byDay(recent.filter((item) => matchesQuery(query(), item.title, item.kind, item.project)))
  );
  const searching = () => query().trim() !== '';
  return VStack({ spacing: 10 }, [
    HStack({ spacing: 4 }, [searchField('Search recent files…', setQuery), ...folderButton(entry.folders?.recent)]),
    VStack({ spacing: 6 }, [dayCards(days, searching, row)]),
    Text(() =>
      days().length ? '' : searching() ? 'No matching files.' : 'Nothing changed in the last 30 days.'
    )
      .font(11)
      .color('tertiary')
      .paddingHorizontal(4)
  ]);
};
