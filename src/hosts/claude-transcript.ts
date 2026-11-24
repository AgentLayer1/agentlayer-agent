import { BACKGROUND_RUNS } from '../../mods/shared/background';
import { HOST_NAMES } from '@/hosts/contract';
import {
  ENTRY_SPLIT_RE,
  TRAILING_SEPARATOR_RE,
  TURN_MARKER,
  TURN_SPLIT_RE,
  USER_LABEL
} from '@/knowledge/session-format';

// How Claude Code writes what a turn ran: a slash command as `<command-message>plugin:skill</command-message>` with its
// arguments in `<command-args>`, the skill's text as a turn of its own, and a note before a local command such as /clear.
// Only Claude Code runs this plugin's background work; another host's transcripts never match.
const COMMAND_RE = /^<command-message>([^<]*)<\/command-message>/;
const ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/;
const SKILL_BODY = /^Base directory for this skill:/;
const CAVEAT_ONLY = /^<local-command-caveat>[\s\S]*<\/local-command-caveat>\s*$/;
const ROLE_RE = new RegExp(`^${TURN_MARKER} ?`);

/** Whether a turn's text is Claude Code's record of running one of this plugin's background runs. */
export const isBackgroundRun = (text: string, plugin: string): boolean => {
  const command = COMMAND_RE.exec(text)?.[1] ?? '';
  if (!command.startsWith(`${plugin}:`)) {
    return false;
  }
  const args = (ARGS_RE.exec(text)?.[1] ?? '').trim();
  return Object.values(BACKGROUND_RUNS).some(
    (run) => command === `${plugin}:${run.skill}` && (run.args === undefined || run.args === args)
  );
};

/** Claude Code's note before a local command such as /clear: alone in a turn, it says nothing. */
export const isCaveatOnly = (text: string): boolean => CAVEAT_ONLY.test(text);

/**
 * Which turns belong to one of this plugin's background runs, judged from their text, for logs and transcripts that
 * don't record who started each prompt: the run's command, the skill text after it, and every reply until the
 * operator speaks again. A turn that is only the local-command note counts too.
 */
export const backgroundByText = (turns: readonly { role: string; text: string }[], plugin: string): boolean[] =>
  turns.reduce<{ flags: boolean[]; inRun: boolean }>(
    ({ flags, inRun }, turn) => {
      if (turn.role === 'user' && isCaveatOnly(turn.text)) {
        flags.push(true);
        return { flags, inRun };
      }
      const opensRun = turn.role === 'user' && isBackgroundRun(turn.text, plugin);
      const run = opensRun || (inRun && (turn.role !== 'user' || SKILL_BODY.test(turn.text)));
      flags.push(run);
      return { flags, inRun: run };
    },
    { flags: [], inRun: false }
  ).flags;

const OTHER_HOSTS = HOST_NAMES.filter((host) => host !== 'claude');
const fromOtherHost = (entry: string): boolean => {
  const header = entry.slice(0, entry.indexOf('\n') === -1 ? entry.length : entry.indexOf('\n'));
  return OTHER_HOSTS.some((host) => header.includes(` · ${host}`));
};

/**
 * Session-log text without this plugin's background runs: each Claude Code entry keeps its header and its other
 * turns, and one left with no turn is dropped whole. For logs written before capture kept these runs out.
 */
export const withoutBackgroundRuns = (text: string, plugin: string): string =>
  // A log written since capture kept these runs out holds none of their commands, so most reads skip the parse.
  !text.includes(`<command-message>${plugin}:`) && !text.includes('<local-command-caveat>')
    ? text
    : text
        .split(ENTRY_SPLIT_RE)
        .map((entry) => {
          const separator = TRAILING_SEPARATOR_RE.exec(entry)?.[0] ?? '';
          const [head = '', ...pieces] = entry.slice(0, entry.length - separator.length).split(TURN_SPLIT_RE);
          if (pieces.length === 0 || fromOtherHost(entry)) {
            return entry;
          }
          const turns = pieces.map((piece) =>
            piece.startsWith(USER_LABEL)
              ? { role: 'user', text: piece.replace(ROLE_RE, '') }
              : { role: 'assistant', text: piece }
          );
          const flags = backgroundByText(turns, plugin);
          const kept = pieces.filter((_piece, index) => !flags[index]);
          return kept.length === 0 ? '' : `${[head, ...kept].join('\n\n')}${separator}`;
        })
        .join('');
