/** The name and emoji a new agent wakes up with until the operator picks its own. */
export const DEFAULT_AGENT_NAME = 'Oppi';
export const DEFAULT_AGENT_EMOJI = '🐙';

/** The emoji an IDENTITY.md declares: the field's first word, or '' when it has none or init left a placeholder. */
export const emojiIn = (identity: string): string => {
  const emoji = /\*\*Emoji:\*\*[ \t]*(\S+)/.exec(identity)?.[1] ?? '';
  return emoji.includes('{{') ? '' : emoji;
};

export interface AgentColors {
  primary: string;
  accent: string;
}

/** Oppi's orchid and mint, the colors a new agent wakes up with. */
export const DEFAULT_AGENT_COLORS: AgentColors = { primary: '#B456A8', accent: '#3BAA70' };

/** The colors an IDENTITY.md's `**Colors:**` line declares, its first two `#RRGGBB` codes, else the default pair. */
export const colorsIn = (identity: string): AgentColors => {
  const line = /\*\*Colors:\*\*(.*)$/m.exec(identity)?.[1] ?? '';
  const [primary, accent] = line.match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
  return primary && accent ? { primary: primary.toUpperCase(), accent: accent.toUpperCase() } : DEFAULT_AGENT_COLORS;
};
