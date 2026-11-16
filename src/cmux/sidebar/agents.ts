import { packLines } from './lines';
import { homeLabel } from './view';

// Points across the sidebar for chips: the first line shares its row with the tab pill.
const FIRST_LINE = 190;
const LINE = 260;

// As tall as the tab pill beside it (a 12 pt icon with 5 pt padding, inside 2 pt), and filled like it.
const agentButton = (label: string, active: () => boolean, onTap: () => void) =>
  Text(label)
    .font(11)
    .weight('semibold')
    .paddingHorizontal(9)
    .paddingVertical(7)
    .cornerRadius(8)
    .color(() => (active() ? 'primary' : 'secondary'))
    .background(() => (active() ? '#7f7f7f3d' : '#7f7f7f1f'))
    .hoverBackground('#7f7f7f3d')
    .cursor('pointer')
    .fixedSize('horizontal')
    .onTap(onTap);

export interface AgentHeaderOptions {
  pill: View;
  homes: readonly string[];
  home: () => string | undefined;
  pick: (home: string) => void;
}

/**
 * The tab pill, then a chip per joined agent, lit for the one the workspace shows; chips that don't fit beside the
 * pill continue on lines below.
 */
export const agentHeader = ({ pill, homes, home, pick }: AgentHeaderOptions) => {
  const agentChip = (path: string) =>
    agentButton(
      homeLabel(path),
      () => home() === path,
      () => pick(path)
    );
  const [first = [], ...rest] = packLines(homes, homeLabel, FIRST_LINE, LINE);
  return VStack({ spacing: 4, alignment: 'leading' }, [
    HStack({ spacing: 8 }, [pill, HStack({ spacing: 4 }, first.map(agentChip)), Spacer({ minLength: 0 })]),
    ...rest.map((line) => HStack({ spacing: 4 }, [...line.map(agentChip), Spacer({ minLength: 0 })]))
  ]);
};
