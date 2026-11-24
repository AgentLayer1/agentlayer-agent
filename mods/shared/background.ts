/**
 * The runs this plugin starts on its own, which the brain never keeps: what they produce is written by the runs
 * themselves. The heartbeat issues them from here and capture recognises them from here, so the two can't drift; a new
 * background run is one more entry.
 */
export const BACKGROUND_RUNS = {
  look: { skill: 'proposals', args: undefined },
  refresh: { skill: 'sync', args: 'brain' }
} as const;
