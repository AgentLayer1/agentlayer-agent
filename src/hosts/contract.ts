import type { DialectTerm } from '@/hosts/dialect';

/**
 * Every host the plugin runs inside. A name is stored in installed homes' hook commands, in day-file headers and
 * in the pending-capture queue, so it never changes.
 */
export const HOST_NAMES = ['claude', 'codex'] as const;

export type HostName = (typeof HOST_NAMES)[number];

export const isHostName = (value: string): value is HostName => HOST_NAMES.some((name) => name === value);

export interface GuardPolicy {
  /**
   * A shell `cd` carries over to the host's next command.
   */
  cdCarries: boolean;
  powershellOn: (platform: NodeJS.Platform) => boolean;
}

export interface HostFloor {
  version: string;
  why: string;
  update: string;
}

/**
 * The session-start hook sends the static stack, with a glossary for the skills' Claude Code terms.
 */
export interface InjectDelivery {
  kind: 'inject';
  glossary: Record<DialectTerm, string>;
}

/**
 * How the operator runs the named skill on a host: what the plugin writes wherever its own text names one.
 */
export type SkillCommand = (name: string) => string;

export interface HostAdapter {
  name: HostName;
  /**
   * The folder the session was launched from, where the hook's cwd can drift away from it.
   */
  launchDir: () => string | undefined;
  /**
   * `import`: the host loads the static stack itself.
   */
  delivery: { kind: 'import' } | InjectDelivery;
  /**
   * The host's terminal renders ANSI colour and draws the mods' prompt row.
   */
  terminal: () => boolean;
  /**
   * How a session capture answers the hook: a host envelope, or the raw result as JSON.
   */
  captureReply: 'envelope' | 'json';
  guard: GuardPolicy;
  floor: HostFloor;
  /**
   * The home is wired for this host.
   */
  usedBy: (home: string) => boolean;
  skill: SkillCommand;
  /**
   * Problems in the home's wiring for this host, one line each, naming skills the session host's way.
   */
  homeIssues: (home: string, skill: SkillCommand) => string[];
  /**
   * This session bills the wrong account: the banner's line, and the context section that has the agent report it.
   */
  billing: () => { banner: string; section: string } | null;
}
