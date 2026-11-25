import type { SessionStartResult } from '@/hooks/session-start';
import type { DialectTerm } from '@/hosts/dialect';

/**
 * Every host the plugin runs inside. A name is stored in installed homes' hook commands, in day-file headers and
 * in the pending-capture queue, so it never changes.
 */
export const HOST_NAMES = ['claude', 'codex', 'antigravity'] as const;

export type HostName = (typeof HOST_NAMES)[number];

export const isHostName = (value: string): value is HostName => HOST_NAMES.some((name) => name === value);

/**
 * What the agent can do on a host, in the order `hosts status` lists them, with each row's short label.
 */
export const CAPABILITIES = [
  { id: 'manual', label: 'Manual' },
  { id: 'context', label: 'Session context' },
  { id: 'banner', label: 'Banner shown' },
  { id: 'capture', label: 'Capture' },
  { id: 'guard', label: 'Shell guard' },
  { id: 'rules', label: 'Home rules' },
  { id: 'tools', label: 'Agent tools' },
  { id: 'skills', label: 'Skills' },
  { id: 'ask', label: 'Question prompt' },
  { id: 'setup', label: 'Setup, upgrade' },
  { id: 'mods', label: 'Mods' },
  { id: 'radar', label: 'Session radar' }
] as const;

export type Capability = (typeof CAPABILITIES)[number]['id'];

export type Support = { level: 'yes' } | { level: 'partial' | 'no'; note: string };

/** What only Claude Code can do, for every other host's capability table. */
export const CLAUDE_CODE_ONLY = {
  mods: {
    level: 'no',
    note: 'instant commands, the heartbeat, bands and notices are mods, which only Claude Code runs'
  },
  radar: {
    level: 'no',
    note: "the session radar reads Claude Code transcripts only; find-session finds every host's sessions"
  }
} as const satisfies Partial<Record<Capability, Support>>;

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
  /** The files the hook sends, in order. */
  files: () => string[];
  glossary: Record<DialectTerm, string>;
  /** Where the glossary reaches the session: the injected context, or an always-on rule the plugin ships. */
  glossaryIn: 'context' | 'rule';
}

/**
 * A tool call as the hook layer sees it, whatever the host calls the tool and its arguments.
 */
export type ToolCall =
  | { kind: 'shell'; command: string; /** The call asks to run outside the host's sandbox. */ bypass?: boolean }
  | { kind: 'read' | 'write' | 'search'; path: string }
  | { kind: 'mcp'; server: string; tool: string }
  | { kind: 'other' };

/**
 * A hook payload in the host-neutral shape the hook verbs read.
 */
export interface HookPayload {
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  /** `child` for a subagent's conversation, which gets no context and no capture of its own. */
  origin: 'user' | 'child';
  call: ToolCall;
  /** The agent home the session works in, for a host whose hooks run outside it; absent when it works in none. */
  home?: string;
  /** Folders the host keeps for the session itself (its artifacts), which its file tools may always use. */
  hostFolders?: string[];
}

/**
 * What a home's rules decide for a tool call, in a host that can ask: null leaves the call to the host's own rules.
 */
export type PolicyDecision = { decision: 'deny' | 'force_ask'; reason: string } | { decision: 'auto_approve' } | null;

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
  title: string;
  /** The title in a narrow table column. */
  column: string;
  capabilities: Record<Capability, Support>;
  /** How the operator wires a home for this host, for a home that isn't. */
  setup: string;
  readPayload: (raw: string) => HookPayload;
  /**
   * The guard's answer: `null` lets the call through.
   */
  guardReply: (refusal: string | null) => HookReply;
  /**
   * The policy hook's answer, for a host that runs it on every tool call.
   */
  policyReply?: (decision: PolicyDecision) => HookReply;
  /**
   * The hooks run outside the home, so each verb takes the home from the payload and does nothing without one.
   */
  homeFromPayload?: true;
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
  /**
   * The host has no session-end event, so its hooks record each conversation for the drain to save.
   */
  recordsConversations: boolean;
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
   * Problems in this machine's own setup for the host, whatever session is asking, one line each.
   */
  machineIssues: () => string[];
  /**
   * Checked for the session's own host only, unlike `homeIssues`.
   */
  launchIssue: () => LaunchIssue | null;
}
