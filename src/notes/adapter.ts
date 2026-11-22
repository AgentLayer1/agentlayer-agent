import { log } from '@/shared/log';
import type { Note } from './ledger';

/**
 * What an adapter may need to deliver a note: the home and the agent's name.
 */
export interface NoteContext {
  home: string;
  agentName: string;
}

/**
 * A place a note can reach the operator: a report file, a notification, a workspace app, a chat. The core works
 * with any of them and imports none.
 */
export interface NoteAdapter {
  name: string;
  /**
   * Runs even when `AGENT_NOTES_DELIVER` leaves it out, so a home with nothing else set up still keeps every note.
   */
  always?: boolean;
  /**
   * Adapters in one group stand in for each other: only the first available one, in list order, is used.
   */
  group?: string;
  /**
   * Whether this adapter can reach the operator from here (an app is installed, the session it notifies is open).
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

/**
 * The adapters to use: every available one, or only those `AGENT_NOTES_DELIVER` names (comma-separated) and the
 * always-on ones, and of each group the first.
 */
export const chosenAdapters = (
  adapters: readonly NoteAdapter[],
  context: NoteContext,
  env: Readonly<Record<string, string | undefined>>
): NoteAdapter[] => {
  const named = (env.AGENT_NOTES_DELIVER ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const usable = adapters.filter(
    (adapter) => (adapter.always || named.length === 0 || named.includes(adapter.name)) && adapter.available(context)
  );
  return usable.filter(
    (adapter, index) => !adapter.group || usable.findIndex(({ group }) => group === adapter.group) === index
  );
};

/**
 * Delivers one note through each adapter and says which took it; one that fails is logged and the rest still run.
 */
export const deliverNote = async (
  note: Note,
  adapters: readonly NoteAdapter[],
  context: NoteContext
): Promise<string[]> => {
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      if (!adapter.deliver) {
        return null;
      }
      try {
        await adapter.deliver(note, context);
        return adapter.name;
      } catch (error) {
        log
          .with('notes')
          .warn(`${adapter.name} didn't deliver ${note.id}: ${error instanceof Error ? error.message : String(error)}`);
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
      log
        .with('notes')
        .warn(`${adapter.name} didn't redraw: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
