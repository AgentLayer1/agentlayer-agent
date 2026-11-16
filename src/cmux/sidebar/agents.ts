import { chip } from 'cmux-custom-manager/components';
import { packLines } from './lines';
import { homeLabel } from './view';

// Points across the sidebar for chips: the first line shares its row with the tab pill.
const FIRST_LINE = 190;
const LINE = 260;

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
    chip(
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
