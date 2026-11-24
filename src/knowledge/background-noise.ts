// A heartbeat look or brain refresh reported as news: what those runs left in memory before capture kept them out.
const BACKGROUND_REPORT = [
  /nothing new worth proposing/i,
  /\bproposals? looks?\b/i,
  /\bbrain refresh(?:ed)?\b[^.]*\bcompiled \d+/i
];

/** Whether a memory line reports what a heartbeat look or brain refresh found. */
export const isBackgroundReport = (line: string): boolean => BACKGROUND_REPORT.some((pattern) => pattern.test(line));
