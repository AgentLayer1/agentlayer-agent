/**
 * A project's colour: the dashboard's `hsl(hue, 55%, 62%)`, as hex for the native renderer.
 */
export const hueColor = (hue: number): string => {
  const saturation = 0.55;
  const lightness = 0.62;
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const sector = (offset + hue / 30) % 12;
    const level = lightness - chroma * Math.max(-1, Math.min(sector - 3, 9 - sector, 1));
    return Math.round(level * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};

const SEGMENTS = 20;

/**
 * A thin progress bar in `color`. Drawn from shapes because cmux's ProgressView ignores its colour.
 */
export const progressBar = (fraction: number, color: string) => {
  const filled = Math.round(Math.min(Math.max(fraction, 0), 1) * SEGMENTS);
  return HStack(
    { spacing: 0 },
    Array.from({ length: SEGMENTS }, (_, index) =>
      Rectangle()
        .fill(index < filled ? color : '#7f7f7f33')
        .frame({ maxWidth: 'infinity', height: 4 })
    )
  ).cornerRadius(2);
};

type LiveText = string | (() => string);
type LiveCount = number | (() => number);

const textOf = (text: LiveText): string => (typeof text === 'string' ? text : text());
const countOf = (count: LiveCount): number => (typeof count === 'number' ? count : count());

export const groupTitle = (title: LiveText, count: LiveCount) =>
  HStack({ spacing: 4 }, [
    Text(() => textOf(title).toUpperCase())
      .font(10)
      .weight('semibold')
      .color('tertiary'),
    Text(() => String(countOf(count)))
      .font(10)
      .monospaced()
      .color('quaternary'),
    Spacer({ minLength: 0 })
  ]).paddingHorizontal(4);

export const chevron = (expanded: () => boolean) =>
  Image(() => (expanded() ? 'chevron.down' : 'chevron.right'))
    .font(9)
    .weight('semibold')
    .color('tertiary');

/**
 * A group title that folds its group: tapping it flips `expanded`.
 */
export const foldTitle = (
  title: LiveText,
  count: LiveCount,
  expanded: () => boolean,
  setExpanded: (next: boolean) => void
) =>
  HStack({ spacing: 4 }, [groupTitle(title, count), chevron(expanded)])
    .paddingTrailing(4)
    .cursor('pointer')
    .onTap(() => setExpanded(!expanded()));

// Titles sit a step below full white (or black) so a list of them reads softer.
export const TITLE_OPACITY = 0.85;

/**
 * A tappable row in a list: no hover wash, since one per row made a long sidebar lag as it scrolled.
 */
export const listRow = (view: View) =>
  view.paddingHorizontal(4).paddingVertical(5).cursor('pointer').frame({ maxWidth: 'infinity', alignment: 'leading' });

/**
 * Rows with a faint line between them. Whether a row leads stays live, since a search reorders the rows it keeps.
 */
export const dividedList = <Item>(items: () => Item[], key: (item: Item) => string, row: (item: Item) => View) => {
  // One computed for the list, so a reorder re-runs only the rows whose divider changes.
  const headKey = computed(() => {
    const head = items()[0];
    return head === undefined ? '' : key(head);
  });
  return VStack({ spacing: 0 }, [
    ForEach({ items, key }, (item, itemKey) =>
      VStack({ spacing: 0 }, [
        Divider()
          .opacity(() => (headKey() === itemKey ? 0 : 0.5))
          .paddingHorizontal(4),
        row(item())
      ])
    )
  ]);
};

/**
 * `build`'s view while `show()` holds, and nothing otherwise; the runtime has no conditional view, so it is a list of
 * one or none.
 */
export const when = (show: () => boolean, build: () => View) =>
  ForEach({ items: () => (show() ? ['shown'] : []), key: (name) => name }, build);

/**
 * A project as its pill names it: its slug and its colour.
 */
export interface ProjectTag {
  slug: string;
  color: string;
}

/**
 * A short text that keeps its own width: beside a Spacer, a text is offered only part of the row and wraps.
 */
export const keepWidth = (view: View) => view.lineLimit(1).fixedSize('horizontal');

/**
 * A word on a tint of its own colour, for a project or a report's status. `color` is `#rrggbb`.
 */
export const pill = (label: string, color: string) =>
  keepWidth(
    Text(label)
      .font(9)
      .weight('semibold')
      .color(color)
      .paddingHorizontal(5)
      .paddingVertical(1)
      .background(`${color}26`)
      .cornerRadius(4)
  );

/**
 * A plain icon button for the top row; `help` names it on hover.
 */
export const toolIcon = (symbol: string, help: string, onTap: () => void) =>
  Image(symbol)
    .font(11)
    .color('secondary')
    .padding(5)
    .cornerRadius(6)
    .hoverBackground('#7f7f7f3d')
    .cursor('pointer')
    .help(help)
    .onTap(onTap);

const CARD = '#7f7f7f12';

/**
 * A card that folds from its header. The padding sits inside the tappable header, so a click in the card's margin
 * folds it too; `body` is built only while it's open.
 */
export const foldingCard = (
  header: View,
  expanded: () => boolean,
  setExpanded: (next: boolean) => void,
  body: () => View
) =>
  VStack({ spacing: 0 }, [
    VStack({ spacing: 0 }, [
      header
        .paddingHorizontal(10)
        .paddingTop(8)
        .paddingBottom(() => (expanded() ? 6 : 8))
    ])
      .frame({ maxWidth: 'infinity', alignment: 'leading' })
      .cursor('pointer')
      .onTap(() => setExpanded(!expanded())),
    when(expanded, () => body().paddingHorizontal(10).paddingBottom(8))
  ])
    .background(CARD)
    .cornerRadius(10)
    .frame({ maxWidth: 'infinity' });

interface FoldCard {
  title: LiveText;
  count: LiveCount;
  icon: string;
  color: string;
  expanded: () => boolean;
  setExpanded: (next: boolean) => void;
}

/**
 * A folding card whose header is an icon, a title, a count and the chevron.
 */
export const foldCard = ({ title, count, icon, color, expanded, setExpanded }: FoldCard, content: () => View) =>
  foldingCard(
    HStack({ spacing: 7 }, [
      Image(icon).font(11).color(color),
      Text(() => textOf(title))
        .font(12)
        .weight('semibold')
        .lineLimit(1)
        .truncation('tail')
        .frame({ maxWidth: 'infinity', alignment: 'leading' }),
      Text(() => String(countOf(count)))
        .font(10)
        .weight('medium')
        .monospaced()
        .color('secondary'),
      chevron(expanded)
    ]),
    expanded,
    setExpanded,
    content
  );

// The sidebar's palette, shared by its icons, badges and tallies.
export const ACCENT = '#0A84FF';
export const GREEN = '#34C759';
export const ORANGE = '#FF9F0A';
export const RED = '#FF453A';
export const GREY = '#8E8E93';
export const PURPLE = '#BF5AF2';

export const note = (text: string) => Text(text).font(11).color('tertiary').paddingHorizontal(10);

/**
 * A page's headline: a small label over a line or two of italic text, on a tinted card.
 */
export const banner = (label: LiveText, text: string) =>
  HStack({ spacing: 10 }, [
    Image('sparkles').font(13).color(PURPLE),
    // A text beside a Spacer gets half the row and wraps early, so the column takes the width itself.
    VStack({ spacing: 2, alignment: 'leading' }, [
      Text(() => textOf(label).toUpperCase())
        .font(9)
        .weight('semibold')
        .color('tertiary'),
      Text(text).font(14).weight('semibold').italic().opacity(TITLE_OPACITY)
    ]).frame({ maxWidth: 'infinity', alignment: 'leading' })
  ])
    .paddingHorizontal(12)
    .paddingVertical(10)
    .background(`${PURPLE}1f`)
    .cornerRadius(10);

/**
 * An icon-only tab; `help` names it on hover.
 */
export const tabIcon = (symbol: string, help: string, active: () => boolean, onTap: () => void) =>
  Image(symbol)
    .font(12)
    .color(() => (active() ? 'accent' : 'secondary'))
    .padding(5)
    .background(() => (active() ? '#7f7f7f3d' : null))
    .cornerRadius(6)
    .hoverBackground('#7f7f7f3d')
    .cursor('pointer')
    .help(help)
    .onTap(onTap);
