import { CLI_COMMAND } from '@/shared/naming';
import { canScout, readPublic, scoutBrief } from './brief';
import { nowISO } from '@/shared/date';
import { notesProblem, readNotes, writeNotes } from './ledger';
import { HOME_LENSES, LENS_KEYS, webLensOf } from './lenses';
import { DAILY_CAP, lensRecord, notesOn, pickLens, roomToday, sentLately } from './rules';

const USAGE = [
  `Usage: ${CLI_COMMAND} notes <command>`,
  `  list [--json]    Today's notes, the room left, and the notes of the last two weeks`,
  `  brief [--json]   Hand out the next scouting run's lens (recorded as run), and for a web lens the scout's whole task`
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
    console.log(JSON.stringify({ cap: DAILY_CAP, room, today: today.length, recent }));
    return 0;
  }
  const lines = today.map(({ id, title, state }) => `${id}  ${title}${state === 'waiting' ? '' : ` (${state})`}`);
  console.log([`${today.length} of ${DAILY_CAP} notes today · room for ${room}`, ...lines].join('\n'));
  return 0;
};

// The heartbeat hands a web lens's brief to the scout as written; a home lens runs in the heartbeat itself.
const brief = (args: readonly string[]): number => {
  const problem = notesProblem();
  if (problem) {
    console.error(problem);
    return 1;
  }
  const ledger = readNotes();
  const now = new Date();
  const known = readPublic();
  known?.refused.forEach(({ line, reason }) => console.error(`Left out of the public brief: "${line}" (${reason}).`));
  const lens = pickLens(lensRecord(ledger), known && canScout(known.facts) ? LENS_KEYS : HOME_LENSES);
  // A brief is handed to a run, so its lens counts as run whether or not it finds anything.
  writeNotes({ ...ledger, ranAt: { ...ledger.ranAt, [lens]: nowISO(now) } });
  const web = webLensOf(lens);
  const prompt = web && known ? scoutBrief(known.facts, web, ledger, now) : '';
  if (args.includes('--json')) {
    console.log(JSON.stringify({ lens, prompt }));
    return 0;
  }
  console.log(prompt || `Lens: ${lens}, run in the heartbeat with no web.`);
  return 0;
};

/**
 * `notes …`: the CLI over the notes core. Returns the process exit code.
 */
export const runNotesCommand = (command: string | undefined, args: readonly string[]): number => {
  if (command === 'list') {
    return list(args);
  }
  if (command === 'brief') {
    return brief(args);
  }
  console.error(USAGE);
  return 1;
};
