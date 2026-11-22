/**
 * How the plugin reaches the operator's surfaces, one import per adapter. The cores take these and never import an
 * adapter themselves.
 */
import { cmuxLauncher } from '@/cmux/launcher';
import { redrawSidebar } from '@/cmux/lifecycle';
import { cmuxNotesAdapter } from '@/cmux/notes';
import { macNotesAdapter } from '@/desktop/notify';
import type { NoteAdapter } from '@/notes/adapter';
import { reportAdapter } from '@/reports/notes';
import type { SessionLauncher } from '@/sessions/launch';

/**
 * Every way to open a session beside this one; with none that can reach it, a Start prints what to run by hand.
 */
export const LAUNCHERS: readonly SessionLauncher[] = [cmuxLauncher];

/**
 * Every place a note can reach the operator.
 */
export const NOTE_ADAPTERS: readonly NoteAdapter[] = [reportAdapter, cmuxNotesAdapter, macNotesAdapter];

const SURFACES: readonly ((home: string) => void)[] = [redrawSidebar];

/**
 * Redraws every surface that shows the home, after a proposal, a note or the heartbeat changed.
 */
export const redrawHome = (home: string): void => SURFACES.forEach((redraw) => redraw(home));
