/**
 * Every place proposals can be shown and started from, one import per adapter. The proposals core takes this list
 * and never imports an adapter itself; with none that can reach a session, a Start prints what to run by hand.
 */
import { cmuxAdapter } from '@/cmux/proposals';
import type { ProposalAdapter } from '@/proposals/adapter';

export const ADAPTERS: readonly ProposalAdapter[] = [cmuxAdapter];
