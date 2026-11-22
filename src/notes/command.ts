import { CLI_COMMAND } from '@/shared/naming';
import { notesProblem, readNotes } from './ledger';
import { DAILY_CAP, lensRecord, notesOn, roomToday, sentLately } from './rules';

const USAGE = [
  `Usage: ${CLI_COMMAND} notes <command>`,
  `  list [--json]   Today's notes, the room left, and each lens's record`
].join('\n');

const list = (args: readonly string[]): number => {
  const problem = notesProblem();
  if (problem) {
    console.error(problem);
    return 1;
  }
  const ledger = readNotes();
  const now = new Date();
  const today = notesOn(ledger, now);
  const room = roomToday(ledger, now);
  if (args.includes('--json')) {
    const recent = sentLately(ledger, now).map(({ id, at, source, lens, title, state }) => ({ id, at, source, lens, title, state }));
    console.log(JSON.stringify({ cap: DAILY_CAP, room, today: today.length, recent, lenses: lensRecord(ledger) }));
    return 0;
  }
  const lines = today.map(({ id, title, state }) => `${id}  ${title}${state === 'waiting' ? '' : ` (${state})`}`);
  console.log([`${today.length} of ${DAILY_CAP} notes today · room for ${room}`, ...lines].join('\n'));
  return 0;
};

/**
 * `notes …`: the CLI over the notes core. Returns the process exit code.
 */
export const runNotesCommand = (command: string | undefined, args: readonly string[]): number => {
  if (command === 'list') {
    return list(args);
  }
  console.error(USAGE);
  return 1;
};
