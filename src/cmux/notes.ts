import type { NoteAdapter } from '@/notes/adapter';
import { buildWork } from '@/work/build';
import { callCmux, cmuxVersion, type CmuxCall } from './app';
import { refreshSidebarQuietly } from './lifecycle';

/**
 * Notes through cmux, over a given runner so a test can watch the calls: a desktop notification that cmux ties to
 * the heartbeat's tab, so opening it lands there.
 */
export const cmuxNotesAdapterWith = (run: (args: string[]) => CmuxCall, installed: () => boolean): NoteAdapter => ({
  name: 'cmux',
  available: ({ heartbeat }) => heartbeat?.adapter === 'cmux' && installed(),
  deliver: (note, { agentName, heartbeat }) => {
    if (heartbeat?.adapter !== 'cmux') {
      throw new Error('The heartbeat has no cmux tab.');
    }
    const args = ['notify', '--title', `${agentName} · Note`, '--body', note.title];
    const place = ['--surface', heartbeat.surfaceId, '--workspace', heartbeat.workspaceId, '--desktop', 'true'];
    const result = run([...args, ...place]);
    if (!result.ok) {
      throw new Error(result.output || 'cmux didn’t take the notification.');
    }
  },
  publish: ({ home }) => {
    refreshSidebarQuietly(home, buildWork());
  }
});

export const cmuxNotesAdapter = cmuxNotesAdapterWith(callCmux, () => cmuxVersion() !== null);
