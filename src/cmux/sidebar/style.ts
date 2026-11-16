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
