import { log } from '@/shared/log';
import type { SessionPlace } from '@/proposals/adapter';
import type { Note } from './ledger';

/**
 * What an adapter may need to deliver a note: the home, the process's environment, the clock, and where the
 * heartbeat's session is, when an adapter can reach it.
 */
export interface NoteContext {
  home: string;
  agentName: string;
  env: Readonly<Record<string, string | undefined>>;
  now: Date;
  heartbeat: SessionPlace | null;
}

/**
 * A place a note can reach the operator: a report file, a notification, a workspace app, a chat. The core works
 * with any of them and imports none.
 */
export interface NoteAdapter {
  name: string;
  /**
   * Whether this adapter can reach the operator from here (an app is installed, the heartbeat has a place in it).
   */
  available: (context: NoteContext) => boolean;
  /**
   * Hands one new note over; throws when it couldn't.
   */
  deliver?: (note: Note, context: NoteContext) => void | Promise<void>;
  /**
   * Redraws wherever this adapter lists notes, after a change.
   */
  publish?: (context: NoteContext) => void;
}

// The report is always written, so a home with nothing else configured still keeps every note.
const ALWAYS = 'report';

/**
 * The adapters to use: every available one, or only those `AGENT_NOTES_DELIVER` names (comma-separated) and the report.
 */
export const chosenAdapters = (adapters: readonly NoteAdapter[], context: NoteContext): NoteAdapter[] => {
  const named = (context.env.AGENT_NOTES_DELIVER ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return adapters.filter(
    (adapter) => (named.length === 0 || named.includes(adapter.name) || adapter.name === ALWAYS) && adapter.available(context)
  );
};

/**
 * Delivers one note through each adapter and says which took it; one that fails is logged and the rest still run.
 */
export const deliverNote = async (note: Note, adapters: readonly NoteAdapter[], context: NoteContext): Promise<string[]> => {
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      if (!adapter.deliver) {
        return null;
      }
      try {
        await adapter.deliver(note, context);
        return adapter.name;
      } catch (error) {
        log.with('notes').warn(`${adapter.name} didn't deliver ${note.id}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    })
  );
  return results.filter((name): name is string => name !== null);
};

/**
 * Redraws every adapter's list of notes; one that fails is logged and the rest still draw.
 */
export const publishNotes = (adapters: readonly NoteAdapter[], context: NoteContext): void =>
  adapters.forEach((adapter) => {
    try {
      adapter.publish?.(context);
    } catch (error) {
      log.with('notes').warn(`${adapter.name} didn't redraw: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
