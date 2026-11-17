import { goalShelf } from '../../work/due';
import type { GoalBlockItem, GoalItem, GoalsItem, HomeEntry } from './data';
import { ACCENT, dividedList, foldCard, GREEN, GREY, ORANGE, pill, PURPLE, TITLE_OPACITY, when } from './style';
import { today } from './tasks';
import { projectColors } from './view';

interface Shelf {
  horizon: GoalBlockItem['horizon'];
  title: string;
  icon: string;
  color: string;
  open: boolean;
}

// The year folds by default: it's the longest, and the theme above keeps it in view.
const SHELVES: readonly Shelf[] = [
  { horizon: 'day', title: 'Today', icon: 'sun.max.fill', color: ORANGE, open: true },
  { horizon: 'week', title: 'This week', icon: 'calendar', color: ACCENT, open: true },
  { horizon: 'month', title: 'This month', icon: 'target', color: GREEN, open: true },
  { horizon: 'year', title: 'This year', icon: 'flag.fill', color: PURPLE, open: false }
];

const themeBanner = ({ label, text }: NonNullable<GoalsItem['theme']>) =>
  HStack({ spacing: 10 }, [
    Image('sparkles').font(13).color(PURPLE),
    // A text beside a Spacer gets half the row and wraps early, so the column takes the width itself.
    VStack({ spacing: 2, alignment: 'leading' }, [
      Text(label.toUpperCase()).font(9).weight('semibold').color('tertiary'),
      Text(text).font(14).weight('semibold').italic().opacity(TITLE_OPACITY)
    ]).frame({ maxWidth: 'infinity', alignment: 'leading' })
  ])
    .paddingHorizontal(12)
    .paddingVertical(10)
    .background(`${PURPLE}1f`)
    .cornerRadius(10);

// A scored goal belongs to a quarter that's over, so it steps back.
const goalRow = (colorOf: (slug: string) => string) => (goal: GoalItem) =>
  VStack({ spacing: 4, alignment: 'leading' }, [
    HStack({ spacing: 6 }, [
      goal.label
        ? pill(goal.label, GREY)
        : Text(String(goal.number)).font(10).weight('semibold').monospaced().color('tertiary'),
      ...(goal.mark ? [Text(goal.mark).font(10)] : []),
      ...(goal.project ? [pill(goal.project, colorOf(goal.project))] : []),
      Spacer({ minLength: 0 })
    ]),
    Text(goal.title).font(12).weight('medium').opacity(TITLE_OPACITY),
    ...(goal.check
      ? [
          VStack({ spacing: 1, alignment: 'leading' }, [
            Text('DONE WHEN').font(9).weight('semibold').color('tertiary'),
            Text(goal.check).font(11).color('secondary')
          ])
        ]
      : []),
    ...(goal.detail ? [Text(goal.detail).font(11).color('tertiary')] : [])
  ])
    .paddingHorizontal(4)
    .paddingVertical(7)
    .frame({ maxWidth: 'infinity', alignment: 'leading' })
    .opacity(goal.mark ? 0.55 : 1);

const shelfCard = (
  shelf: Shelf,
  block: GoalBlockItem | undefined,
  agent: string,
  colorOf: (slug: string) => string
) => {
  const [open, setOpen] = signal(shelf.open);
  const command = `goals ${shelf.horizon}`;
  const view = computed(() => goalShelf(block, today()));
  const live = () => view().current;
  const shown = () => view().goals;
  const caption = (): string => {
    const { weekOf, current } = view();
    if (!weekOf) {
      return block?.caption ?? '';
    }
    return current ? `Week of ${weekOf}` : `Set for the week of ${weekOf} · ask ${agent}: ${command}`;
  };
  return foldCard(
    {
      title: shelf.title,
      count: () => shown().length,
      icon: shelf.icon,
      color: shelf.color,
      expanded: open,
      setExpanded: setOpen
    },
    () =>
      VStack({ spacing: 4 }, [
        when(
          () => caption() !== '',
          () =>
            Text(caption)
              .font(10)
              .color(() => (live() ? 'secondary' : ORANGE))
              .paddingHorizontal(4)
              .frame({ maxWidth: 'infinity', alignment: 'leading' })
        ),
        when(
          () => shown().length === 0,
          () =>
            VStack({ spacing: 2, alignment: 'leading' }, [
              Text(`No goals set for ${shelf.title.toLowerCase()}.`).font(11).color('secondary'),
              Text(`Ask ${agent}: ${command}`).font(10).color('tertiary')
            ])
              .paddingHorizontal(4)
              .paddingVertical(4)
              .frame({ maxWidth: 'infinity', alignment: 'leading' })
        ),
        dividedList(shown, (goal) => String(goal.number), goalRow(colorOf)),
        when(
          () => shown().length > 0 && (block?.notes.length ?? 0) > 0,
          () =>
            VStack(
              { spacing: 4, alignment: 'leading' },
              (block?.notes ?? []).map((note) =>
                Text(note).font(10).italic().color('tertiary').frame({ maxWidth: 'infinity', alignment: 'leading' })
              )
            )
              .paddingHorizontal(4)
              .paddingTop(4)
        )
      ])
  );
};

/**
 * The scoped agent's goals: the year's theme, then today, this week, this month and this year as folding cards, each
 * goal with its headline, what counts as done, and the block's notes at its foot.
 */
export const goalsBody = (entry: HomeEntry) => {
  const { theme, blocks } = entry.goals;
  const colorOf = projectColors(entry);
  return VStack({ spacing: 10 }, [
    ...(theme ? [themeBanner(theme)] : []),
    VStack(
      { spacing: 6 },
      SHELVES.map((shelf) =>
        shelfCard(
          shelf,
          blocks.find((block) => block.horizon === shelf.horizon),
          entry.name,
          colorOf
        )
      )
    )
  ]);
};
