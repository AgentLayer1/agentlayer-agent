import { MCP_PREFIX, PLUGIN_NAME } from '@/config';

/**
 * How Claude Code, the reference dialect, runs a skill: what the plugin's own text writes in front of a skill name.
 */
export const SKILL_PREFIX = `/${PLUGIN_NAME}:`;

/**
 * How the skills spell each host-specific thing. They are written in Claude Code's terms, and every other host's
 * adapter says what each term means there.
 */
export const DIALECT = {
  pluginRoot: '${CLAUDE_PLUGIN_ROOT}',
  toolPrefix: `${MCP_PREFIX}<tool>`,
  askUser: 'AskUserQuestion',
  subagent: 'Agent, a subagent',
  skill: `${SKILL_PREFIX}<name> or Skill(${PLUGIN_NAME}:<name>)`,
  webSearch: 'WebSearch',
  webFetch: 'WebFetch'
} as const;

export type DialectTerm = keyof typeof DIALECT;

const isTerm = (value: string): value is DialectTerm => value in DIALECT;

const TERMS: readonly DialectTerm[] = Object.keys(DIALECT).filter(isTerm);

/**
 * The glossary a non-reference host reads at session start, one term per line.
 */
export const renderGlossary = (host: string, glossary: Record<DialectTerm, string>): string =>
  [
    `<!-- ${PLUGIN_NAME} glossary for ${host}: the skills are written in Claude Code's terms; read each one as follows -->`,
    ...TERMS.map((term) => `- \`${DIALECT[term]}\` → ${glossary[term]}`)
  ].join('\n');
