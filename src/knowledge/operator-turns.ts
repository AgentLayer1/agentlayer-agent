import { ENTRY_SPLIT_RE, parseEntryHeaders, TURN_MARKER } from '@/knowledge/session-format';
import { isConversationUserText } from '@/status/radar-refs';

export interface OperatorTurn {
  sessionId: string;
  date: string;
  text: string;
}

const TURN_SPLIT_RE = new RegExp(`\\n\\n(?=${TURN_MARKER})`);
const USER_LABEL = '**User:**';
const EXCERPT_CHARS = 200;

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
      .filter(isConversationUserText)
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
          const flat = text.replace(/\s+/g, ' ');
          const excerpt = flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}…` : flat;
          return `- session \`${sessionId}\` · date \`${date}\` · ${excerpt}`;
        })
        .join('\n');
