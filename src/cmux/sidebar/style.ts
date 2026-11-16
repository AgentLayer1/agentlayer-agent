import type { Link } from './data';

/**
 * A project's dot colour: the dashboard's `hsl(hue, 55%, 62%)`, as hex for the native renderer.
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

export const label = (text: string, count?: () => number) =>
  HStack({ spacing: 6 }, [
    Text(text).font(10).weight('bold').color('secondary'),
    Text(() => (count ? String(count()) : ''))
      .font(10)
      .monospaced()
      .color('tertiary'),
    Spacer()
  ])
    .paddingHorizontal(10)
    .paddingTop(8)
    .frame({ maxWidth: 'infinity' });

export const note = (text: string) => Text(text).font(11).color('tertiary').paddingHorizontal(10);

export const row = (icon: View, title: string, trailing: string, onTap: () => void) =>
  HStack({ spacing: 8 }, [
    icon,
    Text(title).font(12).lineLimit(1).truncation('tail'),
    Spacer({ minLength: 4 }),
    Image(trailing).font(9).color('tertiary')
  ])
    .paddingHorizontal(10)
    .paddingVertical(5)
    .cornerRadius(8)
    .hoverBackground('#7f7f7f26')
    .cursor('pointer')
    .frame({ maxWidth: 'infinity' })
    .onTap(onTap);

export const symbol = (name: string) => Image(name).font(11).color('secondary').frame({ width: 16 });

/**
 * Opens a note rendered beside the chat, or an HTML page in cmux's browser beside it.
 */
export const open = (link: Pick<Link, 'kind' | 'target'>) =>
  link.kind === 'md' ? cmux('markdown.open', { path: link.target }) : cmux('browser.open_split', { url: link.target });
