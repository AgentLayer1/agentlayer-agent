/** The name and emoji a new agent wakes up with until the operator picks its own. */
export const DEFAULT_AGENT_NAME = 'Oppi';
export const DEFAULT_AGENT_EMOJI = '🐙';

/** The emoji an IDENTITY.md declares: the field's first word, or '' when it has none or init left a placeholder. */
export const emojiIn = (identity: string): string => {
  const emoji = /\*\*Emoji:\*\*[ \t]*(\S+)/.exec(identity)?.[1] ?? '';
  return emoji.includes('{{') ? '' : emoji;
};
