/**
 * Knowledge module state — `.state/knowledge.json`.
 *
 * Persistent across compile runs:
 * - `ingested`: per-file hash + timestamp + cost, used to skip already-compiled inputs
 * - `in_flight`: filename if a compile run crashed mid-file, so the next run can re-attempt
 * - `query_count`: rolling counter (for debugging / cost visibility)
 * - `last_lint`: ISO timestamp of the last lint run
 * - `partial`: how far a multi-chunk slice got, and `feedback_picked`: the feedback hash handed out
 *   (both described on `CompileState` in `knowledge/types.ts`)
 */

import { FILES } from '@/config';
import { createLogger } from '@/shared/log';
import type { CompileState } from '@/knowledge/types';
import { writeJsonAtomic } from '@/shared/utils';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

const log = createLogger('knowledge.state');

const EMPTY_STATE: CompileState = {
  ingested: {},
  in_flight: null,
  partial: {},
  query_count: 0,
  last_lint: null
};

export async function loadState(): Promise<CompileState> {
  if (!existsSync(FILES.KNOWLEDGE_STATE)) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(await readFile(FILES.KNOWLEDGE_STATE, 'utf-8'));
    return {
      ingested: parsed.ingested ?? {},
      in_flight: parsed.in_flight ?? null,
      partial: parsed.partial ?? {},
      query_count: parsed.query_count ?? 0,
      last_lint: parsed.last_lint ?? null,
      ...(typeof parsed.feedback_picked === 'string' && { feedback_picked: parsed.feedback_picked })
    };
  } catch (err) {
    // Corrupt state would silently lose compile-tracking — surface it loud
    // so the operator notices rather than rebuilding work from scratch.
    log.warn('knowledge.json exists but failed to parse — resetting to empty state', err);
    return { ...EMPTY_STATE };
  }
}

export async function saveState(state: CompileState): Promise<void> {
  writeJsonAtomic(FILES.KNOWLEDGE_STATE, state);
}
