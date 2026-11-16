import { cardRow } from 'cmux-custom-dashboard/components';
import { agentCards, ORDER, type Card } from 'cmux-custom-dashboard/model';
import { homeOf } from '../scope';
import { label, note } from '../style';

interface Group {
  key: string;
  title: string;
  cards: Card[];
}

const byUrgency = (first: Card, second: Card) =>
  ORDER.indexOf(first.section) - ORDER.indexOf(second.section) ||
  (second.agent.lastActivityAt ?? 0) - (first.agent.lastActivityAt ?? 0);

/**
 * Every session cmux knows, one section per agent by the folder it runs in, then the rest under Other.
 */
export const agentsPage = (homes: readonly string[]) => {
  const groups = computed((): Group[] => {
    const cards = agentCards();
    const titled = homes.map((home) => ({
      key: home,
      title: `${DATA.homes[home]?.emoji ?? ''} ${DATA.homes[home]?.name ?? home}`.trim(),
      cards: cards.filter((card) => homeOf(homes, card.agent.directory) === home)
    }));
    const other = { key: 'other', title: 'Other', cards: cards.filter((card) => !homeOf(homes, card.agent.directory)) };
    return [...titled, other]
      .filter((group) => group.cards.length)
      .map((group) => ({ ...group, cards: group.cards.toSorted(byUrgency) }));
  });
  return VStack({ spacing: 4 }, [
    ForEach({ items: groups, key: (group) => group.key }, (group) =>
      VStack({ spacing: 4 }, [
        label(group().title, () => group().cards.length),
        ForEach({ items: () => group().cards, key: (card) => card.key }, cardRow)
      ])
    ),
    ForEach({ items: () => (groups().length ? [] : ['empty']), key: (item) => item }, () =>
      note('No agent sessions in cmux right now.')
    )
  ]);
};
