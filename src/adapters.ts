/**
 * Every place proposals can be shown and started from, one import per adapter. The proposals core takes this list
 * and never imports an adapter itself; with none that can reach a session, a Start prints what to run by hand.
 */
import { cmuxNotesAdapter } from '@/cmux/notes';
import { cmuxAdapter } from '@/cmux/proposals';
import { macNotesAdapter } from '@/home/notify';
import type { NoteAdapter } from '@/notes/adapter';
import type { ProposalAdapter } from '@/proposals/adapter';
import { reportAdapter } from '@/reports/notes';

export const ADAPTERS: readonly ProposalAdapter[] = [cmuxAdapter];

/**
 * Every place a note can reach the operator, one import per adapter; the notes core takes this list and imports none.
 */
export const NOTE_ADAPTERS: readonly NoteAdapter[] = [reportAdapter, cmuxNotesAdapter, macNotesAdapter];
