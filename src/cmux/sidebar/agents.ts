import { packLines } from './lines';
import { homeLabel } from './view';

// Points across the sidebar for chips, as measured on cmux 0.65.2's panel: about 280 inside its padding, less the tab
// pill and its gap on the first line.
const FIRST_LINE = 216;
const LINE = 276;

// Sized and filled to sit level with the tab pill beside it (the padding was matched by eye on cmux 0.65.2). The
// lit chip wears its agent's primary color, the fill at a quarter strength.
const agentButton = (label: string, tint: string | undefined, active: () => boolean, onTap: () => void) => {
  const lit = tint ? `${tint}3d` : '#7f7f7f3d';
  return Text(label)
    .font(11)
    .weight('semibold')
    .paddingHorizontal(9)
    .paddingVertical(6)
    .cornerRadius(8)
    .color(() => (active() ? (tint ?? 'primary') : 'secondary'))
    .background(() => (active() ? lit : '#7f7f7f1f'))
    .hoverBackground(lit)
    .cursor('pointer')
    .fixedSize('horizontal')
    .onTap(onTap);
};

export interface AgentOptions {
  pill: View;
  homes: readonly string[];
  home: () => string | undefined;
  pick: (home: string) => void;
}

/**
 * The tab pill, then a chip per joined agent, lit for the one the workspace shows; chips that don't fit beside the
 * pill continue on lines below.
 */
export const agentHeader = ({ pill, homes, home, pick }: AgentOptions) => {
  const agentChip = (path: string) =>
    agentButton(
      homeLabel(path),
      DATA.homes[path]?.colors?.primary,
      () => home() === path,
      () => pick(path)
    );
  const [first = [], ...rest] = packLines(homes, homeLabel, FIRST_LINE, LINE);
  return VStack({ spacing: 4, alignment: 'leading' }, [
    HStack({ spacing: 8 }, [pill, HStack({ spacing: 4 }, first.map(agentChip)), Spacer({ minLength: 0 })]),
    ...rest.map((line) => HStack({ spacing: 4 }, [...line.map(agentChip), Spacer({ minLength: 0 })]))
  ]);
};
