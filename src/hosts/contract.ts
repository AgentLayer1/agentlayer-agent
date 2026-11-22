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
 * The session-start hook sends the static stack.
 */
export interface InjectDelivery {
  kind: 'inject';
}

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
  /**
   * Problems in the home's wiring for this host, one line each.
   */
  homeIssues: (home: string) => string[];
  /**
   * The per-agent subscription check applies: the host bills a subscription the agent can have its own of.
   */
  billsSubscription: boolean;
}
