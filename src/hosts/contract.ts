import type { SessionStartResult } from '@/hooks/session-start';
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
  /**
   * The command that runs the host, when it differs from the host's name.
   */
  binary?: string;
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
 * A tool call as the hook layer sees it, whatever the host calls the tool and its arguments.
 */
export type ToolCall = { kind: 'shell'; command: string } | { kind: 'other' };

/**
 * A hook payload in the host-neutral shape the hook verbs read.
 */
export interface HookPayload {
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  call?: ToolCall;
}

/**
 * What a hook verb writes and the code it exits with.
 */
export interface HookReply {
  stdout?: string;
  stderr?: string;
  code: number;
}

/**
 * A problem with how this session was started: the banner's label and line, and the context section that has the
 * agent report it.
 */
export interface LaunchIssue {
  label: string;
  banner: string;
  section: string;
}

/**
 * How the operator runs the named skill on a host: what the plugin writes wherever its own text names one.
 */
export type SkillCommand = (name: string) => string;

export interface HostAdapter {
  name: HostName;
  readPayload: (raw: string) => HookPayload;
  /**
   * The guard's answer: `null` lets the call through.
   */
  guardReply: (refusal: string | null) => HookReply;
  sessionStartReply: (result: SessionStartResult) => HookReply;
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
   * Checked for the session's own host only, unlike `homeIssues`.
   */
  launchIssue: () => LaunchIssue | null;
}
