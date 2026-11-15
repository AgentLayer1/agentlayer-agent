/** A single text-bearing turn from a harness transcript. */
export interface TranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Model that produced an assistant turn, when the transcript records it. */
  model?: string;
}

/**
 * One entry in state.ingested — tracks a compiled file.
 *
 * `hash` is of the whole file (legacy gating). `bytes` is the incremental
 * compile cursor: the byte offset compiled up to, with `prefix_hash` covering
 * `[0, bytes)` so a non-append edit (rather than a pure append) is detected
 * and triggers a from-scratch recompile. Entries written before incremental
 * compile landed have no `bytes`/`prefix_hash` and fall back to whole-file
 * hash gating — past day-files never change, so they stay skipped.
 */
export interface IngestedEntry {
  hash: string;
  compiled_at: string;
  cost_usd: number;
  bytes?: number;
  prefix_hash?: string;
}

/** One session's slice of a day-file: turns `[from, to]` captured on `date`. */
export interface SessionBlock {
  date: string;
  from: number;
  to: number;
}

/**
 * One session in the raw-session catalog (`raw/sessions/index.json`). Keyed by
 * sessionId. `captured_turns` is the capture cursor (high-water mark of turns
 * written to raw); `last_turn_fp` fingerprints that turn so a rewritten
 * transcript is detected. Reconstructable from day-file block headers.
 */
export interface SessionRecord {
  first_seen: string;
  last_seen: string;
  cwd: string;
  captured_turns: number;
  last_turn_fp: string;
  briefing: string;
  blocks: SessionBlock[];
}

export interface SessionIndex {
  schema: number;
  sessions: Record<string, SessionRecord>;
}

/**
 * One entry in state.partial — tracks how far through a multi-chunk *slice* we
 * got. The slice `[slice_start, slice_end)` is pinned at first pick so an
 * append to the file mid-compile can't shift the chunk count. `hash` covers the
 * pinned slice, so an unexpected rewrite of that region invalidates progress.
 * On full success the entry is deleted and the file's `ingested` cursor
 * advances to `slice_end`.
 */
export interface PartialEntry {
  hash: string;
  slice_start: number;
  slice_end: number;
  completed: number;
  total: number;
  cost_usd: number;
}

/** Shape of knowledge module state file. Persisted between compile runs. */
export interface CompileState {
  ingested: Record<string, IngestedEntry>;
  in_flight: string | null;
  partial: Record<string, PartialEntry>;
  query_count: number;
  last_lint: string | null;
}
