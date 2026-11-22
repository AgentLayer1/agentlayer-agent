import { LAUNCHERS, redrawHome } from '@/adapters';
import { FOLDERS } from '@/config';
import { startPrompt } from '@/sessions/launch';
import { CLI_COMMAND } from '@/shared/naming';
import { flagOf } from '@/shared/utils';
import { notesProblem, readNotes, writeNotes } from './ledger';
import { DAILY_CAP, decideNote, lensRecord, NOTE_CHOICES, notePrompt, notesOn, roomToday, sentLately } from './rules';

const USAGE = [
  `Usage: ${CLI_COMMAND} notes <command>`,
  `  list [--json]                                   Today's notes, the room left, and each lens's record`,
  `  decide <${NOTE_CHOICES.join('|')}> <id> [--workspace=<id>]  Open a session on it (in that cmux workspace when named), put it off until morning, or drop it`
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
    const recent = sentLately(ledger, now).map(({ id, at, source, lens, title, reaction }) => ({ id, at, source, lens, title, reaction }));
    console.log(JSON.stringify({ cap: DAILY_CAP, room, today: today.length, recent, lenses: lensRecord(ledger) }));
    return 0;
  }
  const lines = today.map(({ id, title, reaction }) => `${id}  ${title}${reaction ? ` (${reaction})` : ''}`);
  console.log([`${today.length} of ${DAILY_CAP} notes today · room for ${room}`, ...lines].join('\n'));
  return 0;
};

const decide = (args: readonly string[]): number => {
  const [word, id] = args.filter((arg) => !arg.startsWith('--'));
  const choice = NOTE_CHOICES.find((known) => known === word);
  if (!choice || !id) {
    console.error(USAGE);
    return 1;
  }
  const note = readNotes().notes.find((item) => item.id === id);
  if (!note) {
    console.log(`No note ${id}.`);
    return 0;
  }
  if (note.reaction === 'started' || note.reaction === 'dismissed') {
    console.log(`${note.title}: already ${note.reaction}.`);
    return 0;
  }
  const workspace = flagOf(args, 'workspace');
  const now = new Date();
  const opened =
    choice === 'start'
      ? startPrompt(
          { id, prompt: notePrompt(note) },
          { home: FOLDERS.HOME, adapters: LAUNCHERS, env: process.env, now, ...(workspace ? { workspace } : {}) }
        )
      : null;
  if (opened && 'error' in opened) {
    console.log(`Couldn't start ${note.title}: ${opened.error}`);
    return 1;
  }
  // Read again: a session can take seconds to open, and a decision recorded meanwhile must not be written over.
  writeNotes(decideNote(readNotes(), id, choice, now));
  redrawHome(FOLDERS.HOME);
  const said = {
    start: `Started: ${note.title}. ${opened?.where ?? ''}`.trimEnd(),
    later: `Later: ${note.title} comes back in the morning.`,
    dismiss: `Dismissed: ${note.title}.`
  };
  console.log(said[choice]);
  return 0;
};

/**
 * `notes …`: the CLI over the notes core. Returns the process exit code.
 */
export const runNotesCommand = (command: string | undefined, args: readonly string[]): number => {
  if (command === 'list') {
    return list(args);
  }
  if (command === 'decide') {
    return decide(args);
  }
  console.error(USAGE);
  return 1;
};
