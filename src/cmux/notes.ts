import { existsSync } from 'node:fs';
import { placeOf, readHeartbeat } from '@/heartbeat/ledger';
import type { NoteAdapter } from '@/notes/adapter';
import type { SessionPlace } from '@/sessions/launch';
import { callCmux, CMUX_APP, type CmuxCall } from './app';

/**
 * Notes through cmux, over a given runner so a test can watch the calls: a desktop notification that cmux ties to
 * the heartbeat's tab, so opening it lands there.
 */
export const cmuxNotesAdapterWith = (
  run: (args: string[]) => CmuxCall,
  installed: () => boolean,
  heartbeatTab: () => SessionPlace | null
): NoteAdapter => ({
  name: 'cmux',
  group: 'notify',
  available: () => heartbeatTab() !== null && installed(),
  deliver: (note, { agentName }) => {
    const tab = heartbeatTab();
    if (!tab) {
      throw new Error('The heartbeat has no cmux tab.');
    }
    const args = ['notify', '--title', `${agentName} · Note`, '--body', note.title];
    const place = ['--surface', tab.surfaceId, '--workspace', tab.workspaceId, '--desktop', 'true'];
    const result = run([...args, ...place]);
    if (!result.ok) {
      throw new Error(result.output || 'cmux didn’t take the notification.');
    }
  }
});

export const cmuxNotesAdapter = cmuxNotesAdapterWith(
  callCmux,
  () => existsSync(CMUX_APP),
  () => placeOf(readHeartbeat(), 'cmux')
);
