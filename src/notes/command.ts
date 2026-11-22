import { ADAPTERS } from '@/adapters';
import { FOLDERS } from '@/config';
import { startPrompt } from '@/proposals/start';
import { CLI_COMMAND } from '@/shared/naming';
import { notesProblem, readNotes, writeNotes } from './ledger';
import { DAILY_CAP, lensRecord, notesOn, react, roomToday } from './rules';

const USAGE = [
  `Usage: ${CLI_COMMAND} notes <command>`,
  `  list [--json]                   Today's notes, the room left, and each lens's record`,
  `  react <useful|dismiss> <id>     Say how a note landed; the next scouting reads it`,
  `  start <id> [--workspace=<id>]   Open a session on the note's next step, in that cmux workspace when named`
].join('\n');

const REACTIONS = { useful: 'useful', dismiss: 'dismissed' } as const;

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
    const recent = ledger.notes.slice(-20).map(({ id, at, source, lens, title, reaction }) => ({ id, at, source, lens, title, reaction }));
    console.log(JSON.stringify({ cap: DAILY_CAP, room, today: today.length, recent, lenses: lensRecord(ledger) }));
    return 0;
  }
  const lines = today.map(({ id, title, reaction }) => `${id}  ${title}${reaction ? ` (${reaction})` : ''}`);
  console.log([`${today.length} of ${DAILY_CAP} notes today · room for ${room}`, ...lines].join('\n'));
  return 0;
};

/**
 * `notes …`: the CLI over the notes core. Returns the process exit code.
 */
export const runNotesCommand = (command: string | undefined, args: readonly string[]): number => {
  const words = args.filter((arg) => !arg.startsWith('--'));
  if (command === 'list') {
    return list(args);
  }
  if (command === 'react') {
    const [choice, id = ''] = words;
    const reaction = choice === 'useful' || choice === 'dismiss' ? REACTIONS[choice] : null;
    const changed = reaction ? react(readNotes(), id, reaction) : null;
    if (!reaction || !changed) {
      console.error(reaction && id ? `No note ${id}.` : USAGE);
      return 1;
    }
    writeNotes(changed);
    console.log(reaction === 'useful' ? 'Noted: useful.' : 'Dismissed.');
    return 0;
  }
  if (command === 'start') {
    const note = readNotes().notes.find(({ id }) => id === words[0]);
    if (!note?.prompt) {
      console.error(note ? `${note.title} has no session to start.` : `No note ${words[0] ?? ''}.`);
      return 1;
    }
    const workspace = args.find((arg) => arg.startsWith('--workspace='))?.slice('--workspace='.length);
    const opened = startPrompt(note, {
      home: FOLDERS.HOME,
      adapters: ADAPTERS,
      env: process.env,
      now: new Date(),
      ...(workspace ? { workspace } : {})
    });
    console.log('error' in opened ? `Couldn't start it: ${opened.error}` : `Started: ${note.title}. ${opened.where}`);
    return 'error' in opened ? 1 : 0;
  }
  console.error(USAGE);
  return 1;
};
