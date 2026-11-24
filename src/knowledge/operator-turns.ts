import { ENTRY_SPLIT_RE, parseEntryHeaders, TURN_SPLIT_RE, USER_LABEL } from '@/knowledge/session-format';
import { truncate } from '@/status/format';
import { isConversationUserText } from '@/status/radar-refs';

export interface OperatorTurn {
  sessionId: string;
  date: string;
  text: string;
}

const EXCERPT_CHARS = 200;
// The host writes a compaction summary as a user turn; whatever it quotes was said in a turn already listed.
const COMPACTION_SUMMARY = 'This session is being continued';

/**
 * The turns in a session-log chunk the operator typed, each with its block's session id and date. Most `**User:**`
 * turns are skill bodies, command messages and notifications, which a correction can never come from.
 */
export const operatorTurns = (chunk: string): OperatorTurn[] =>
  chunk.split(ENTRY_SPLIT_RE).flatMap((entry) => {
    const [header] = parseEntryHeaders(entry);
    if (!header) {
      return [];
    }
    return entry
      .split(TURN_SPLIT_RE)
      .filter((turn) => turn.startsWith(USER_LABEL))
      .map((turn) => turn.slice(USER_LABEL.length).trim())
      .filter((text) => isConversationUserText(text) && !text.startsWith(COMPACTION_SUMMARY))
      .map((text) => ({ sessionId: header.sessionId, date: header.date, text }));
  });

/**
 * One line per operator turn for the compile prompt: where it came from and enough of it to find in the log.
 */
export const renderOperatorTurns = (turns: readonly OperatorTurn[]): string =>
  turns.length === 0
    ? '_None in this chunk._'
    : turns
        .map(({ sessionId, date, text }) => {
          const excerpt = truncate(text.replace(/\s+/g, ' '), EXCERPT_CHARS);
          return `- session \`${sessionId}\` · date \`${date}\` · ${excerpt}`;
        })
        .join('\n');
