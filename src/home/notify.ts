import type { NoteAdapter } from '@/notes/adapter';

/**
 * A text as an AppleScript string literal: backslashes and quotes escaped, so nothing in it runs as script.
 */
export const appleScriptString = (text: string): string => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

const OSASCRIPT = '/usr/bin/osascript';

/**
 * Notes as a plain macOS notification, standing in for a notifier earlier in the list that can't reach the operator.
 * A click can't open a terminal tab, so the notification says where the note is.
 */
export const macNotesAdapterWith = (run: (argv: string[]) => Promise<boolean>, platform: string): NoteAdapter => ({
  name: 'macos',
  group: 'notify',
  // TODO(windows): no desktop notification off macOS yet; the heartbeat's tab and the report still carry every note.
  available: () => platform === 'darwin',
  deliver: async (note, { agentName }) => {
    const script = `display notification ${appleScriptString(`${note.title} · in the heartbeat's tab and reports/notes`)} with title ${appleScriptString(`${agentName} · Note`)}`;
    if (!(await run([OSASCRIPT, '-e', script]))) {
      throw new Error('osascript didn’t show the notification.');
    }
  }
});

export const macNotesAdapter = macNotesAdapterWith(
  async (argv) => (await Bun.spawn(argv, { stdout: 'ignore', stderr: 'ignore', timeout: 10_000 }).exited) === 0,
  process.platform
);
