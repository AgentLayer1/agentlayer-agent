import { CLI_COMMAND } from '@/shared/naming';
import { agentFor, canScout, homeBrief, readPublic, scoutBrief } from './brief';
import { nowISO } from '@/shared/date';
import { notesProblem, readNotes, writeNotes } from './ledger';
import { FOLDERS } from '@/config';
import { flagOf } from '@/shared/utils';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { HOME_LENS_KEYS, LENS_KEYS, homeLensOf, webLensOf } from './lenses';
import { DAILY_CAP, lensRecord, notesOn, pickLens, roomToday, sentLately } from './rules';

const USAGE = [
  `Usage: ${CLI_COMMAND} notes <command>`,
  `  list [--json]    Today's notes, the room left, and the notes of the last two weeks`,
  `  brief [--json] [--workspaces=<json list>]   Hand out the next scouting run's lens (recorded as run), the agent it runs in, and that agent's whole task`
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

const workspacesOf = (args: readonly string[]): string[] => {
  try {
    const list: unknown = JSON.parse(flagOf(args, 'workspaces') ?? '[]');
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

// The home's own rules for notes, named relative to the home when the file is there.
const rulesFile = (): string => {
  const path = resolve(FOLDERS.SKILL_EXTENSIONS, 'notes.md');
  return existsSync(path) ? relative(FOLDERS.HOME, path) : '';
};

// The heartbeat hands the brief, whole, to the agent it names: the scout for a web lens, the home lens agent otherwise.
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
  const lens = pickLens(lensRecord(ledger), known && canScout(known.facts) ? LENS_KEYS : HOME_LENS_KEYS);
  // A brief is handed to a run, so its lens counts as run whether or not it finds anything.
  writeNotes({ ...ledger, ranAt: { ...ledger.ranAt, [lens]: nowISO(now) } });
  const web = webLensOf(lens);
  const home = homeLensOf(lens);
  const prompt = web && known ? scoutBrief(known.facts, web, ledger, now) : home ? homeBrief(home, ledger, now, workspacesOf(args), rulesFile()) : '';
  if (args.includes('--json')) {
    console.log(JSON.stringify({ lens, agent: agentFor(lens), prompt }));
    return 0;
  }
  console.log(prompt);
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
