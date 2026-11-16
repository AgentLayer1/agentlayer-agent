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

const SEGMENTS = 40;

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

export const groupTitle = (title: string, count: number) =>
  HStack({ spacing: 4 }, [
    Text(title.toUpperCase()).font(10).weight('semibold').color('tertiary'),
    Text(String(count)).font(10).monospaced().color('quaternary'),
    Spacer({ minLength: 0 })
  ]).paddingHorizontal(4);

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

export const note = (text: string) => Text(text).font(11).color('tertiary').paddingHorizontal(10);

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
