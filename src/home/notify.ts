import { cmuxVersion } from '@/cmux/app';
import type { NoteAdapter } from '@/notes/adapter';

/**
 * A text as an AppleScript string literal: backslashes and quotes escaped, so nothing in it runs as script.
 */
export const appleScriptString = (text: string): string => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

const OSASCRIPT = '/usr/bin/osascript';

/**
 * Notes as a plain macOS notification, for a heartbeat cmux can't reach. A click can't open a terminal tab, so the
 * notification says where the note is.
 */
export const macNotesAdapterWith = (
  run: (argv: string[]) => boolean,
  platform: string,
  cmuxInstalled: () => boolean
): NoteAdapter => ({
  name: 'macos',
  // TODO(windows): no desktop notification off macOS yet; the heartbeat's tab and the report still carry every note.
  // Steps aside only when cmux can deliver itself: a heartbeat recorded in cmux on a Mac without it still gets one.
  available: ({ heartbeat }) => platform === 'darwin' && !(heartbeat?.adapter === 'cmux' && cmuxInstalled()),
  deliver: (note, { agentName }) => {
    const script = `display notification ${appleScriptString(`${note.title} · in the heartbeat's tab and reports/notes`)} with title ${appleScriptString(`${agentName} · Note`)}`;
    if (!run([OSASCRIPT, '-e', script])) {
      throw new Error('osascript didn’t show the notification.');
    }
  }
});

export const macNotesAdapter = macNotesAdapterWith(
  (argv) => Bun.spawnSync(argv, { stdout: 'ignore', stderr: 'ignore', timeout: 10_000 }).exitCode === 0,
  process.platform,
  () => cmuxVersion() !== null
);
