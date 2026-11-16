import { cardRow } from 'cmux-custom-dashboard/components';
import type { Card } from 'cmux-custom-dashboard/model';
import { cardsIn } from '../cards';
import { label, note } from '../style';
import { homeLabel } from '../view';

interface Group {
  key: string;
  title: string;
  cards: Card[];
}

/**
 * Every session cmux knows, one section per agent by the folder it runs in, then the rest under Other.
 */
export const agentsPage = (homes: readonly string[]) => {
  const groups = computed((): Group[] =>
    [
      ...homes.map((home) => ({ key: home, title: homeLabel(home), cards: cardsIn(homes, home) })),
      { key: 'other', title: 'Other', cards: cardsIn(homes, undefined) }
    ].filter((group) => group.cards.length)
  );
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
