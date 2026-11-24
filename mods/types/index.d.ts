export interface AgendaItem {
  id: string;
  priority: string;
  title: string;
  daysLate: number;
}

export interface TodayView {
  emoji: string;
  dateLabel: string;
  hijriLabel: string;
  overdue: AgendaItem[];
  dueToday: AgendaItem[];
  syncAgeHours: number | null;
}

export interface CompileBacklog {
  sessions: number;
  feedback: number;
  inbox: number;
}

export interface TaskHealth {
  overdue: number;
  stale: number;
  dueSoon: number;
}

export interface BrainCounts {
  staleTasks: number;
  dormantTasks: number;
  activeOld: number;
  dormantProjects: number;
  memoryLines: number;
  decisions: number;
  staleArticles: number;
  oldCaptureFiles: number;
  brokenPins: number;
  staleSurfaces: number;
  oldestWaiting: string | null;
}

export interface SyncSnapshot {
  compile: CompileBacklog | null;
  tasks: TaskHealth | null;
  brain: BrainCounts | null;
}

export interface SyncActions {
  reposUpdated: number;
  compiled: number;
  lintFixed: number;
  lintErrors: number;
  tasksClosed: number;
  tasksUpdated: number;
  threads: number;
  tasksCreated: number;
}

export interface PhaseTiming {
  phase: string;
  ms: number;
}

export interface SyncRun {
  status: 'running' | 'waiting' | 'done' | 'stopped';
  startedAt: number;
  phase: number;
  phaseStartedAt: number;
  timings: PhaseTiming[];
  actions: SyncActions;
  before: SyncSnapshot | null;
  after: SyncSnapshot | null;
  endedAt: number | null;
  /** The loop that loaded sync; the run ends with one of its turns. */
  owner: string;
  /** The loops doing the sync: the owner and every agent spawned from one of them. */
  loops: string[];
  /** A brain refresh (`sync brain`): its own phases only, kept out of the history, gone when it ends. */
  isBrain?: boolean;
}

export interface SyncHistoryEntry {
  endedAt: number;
  totalMs: number;
  after: SyncSnapshot | null;
}

/**
 * One entry the CLI's `notices` prints, mirrored from src/notices/notices.ts (a mod can't import Node code).
 */
export interface NoticeFact {
  text: string;
  tone?: 'accent' | 'warn';
}

export interface Notice {
  id: string;
  level: 'hint' | 'nudge' | 'alert';
  pinned: boolean;
  icon: string;
  label: string;
  title: string;
  facts: NoticeFact[];
  command: string;
  actionLabel: string;
}

/**
 * A notice whose command was pressed (`isStarted` false until its skill starts) or is running.
 */
export interface NoticeActing {
  id: string;
  isStarted: boolean;
  at: number;
}

/**
 * A report this conversation wrote, edited or attached, as the store keeps it.
 */
export interface SessionReport {
  title: string;
  path: string;
}

/**
 * One row of the /reports band: the page beside the card when there is one, else the card.
 */
export interface ReportRow {
  shownPath: string;
  /** Absent when it would only repeat the file name. */
  title?: string;
}

/** One tick of the heartbeat as its band shows it; repeats of one skip fold into a single event. */
export interface HeartbeatEvent {
  at: number;
  kind: 'look' | 'refresh' | 'notes' | 'skip' | 'stopped';
  /** The look's or refresh's closing line, a skip's reason, or what stopped. */
  text: string;
  /** For a scouting run, how many notes it sent. */
  sent?: number;
  /** How many skips this one stands for, and when the first was; absent for one. */
  count?: number;
  since?: number;
}

/** The heartbeat session's own bookkeeping: the local day it last woke, and the token it is the heartbeat by. */
export interface HeartbeatClock {
  wokeOn: string;
  owner: string;
  /** The conversation the day's /clear left, so its last writes aren't read as another session's. */
  clearedId?: string;
  /** Set while this process is the home's heartbeat, which is when its band shows. */
  isHeartbeat?: boolean;
  everyMinutes?: number;
  /** When the clock ticks next, epoch ms. */
  nextAt?: number;
  /** The home's timezone, which the band's times are read in. */
  zone?: string;
  /** How many proposals showed at the last tick, and the most there are. */
  showing?: number;
  target?: number;
  /** The local day the last notes went out, how many had gone out that day, and the day's cap. */
  notesDay?: string;
  notesSent?: number;
  notesCap?: number;
  /** How many notes the scouting run under way has sent so far. */
  notesThisWake?: number;
  /** When this heartbeat last started a brain refresh, epoch ms, so a failed one isn't retried every tick. */
  refreshTriedAt?: number;
  /** Set when that start was the one retry an unfinished refresh gets, so a second failure waits out the window. */
  refreshRetried?: boolean;
  /** When a sync or brain refresh last ran, epoch ms; 0 when never. */
  refreshedAt?: number;
  /** The latest ticks, newest first. */
  log?: HeartbeatEvent[];
  /** The wake turns started and not yet ended, oldest first: `look`, `refresh` or `notes`. */
  awaiting?: string[];
  /** When the first of `awaiting` was queued, epoch ms. */
  workingSince?: number;
  /** Set when the wake turn under way added or retired a proposal or sent a note, so its end is worth a notification. */
  wakeChanged?: boolean;
  /** The scouting agent under way: the id its spawn answered, when it started (epoch ms), and which agent it is. */
  /** For the scout, the private names its searches and fetches may not carry. */
  scouting?: { id: string; since: number; agent: 'scout' | 'home-lens'; privateNames?: string[] };
}

export interface Queue {
  pending: string[];
  isBusy: boolean;
  /** Set when a turn was stopped or failed; the next turn that ends normally resumes the queue. */
  isPaused: boolean;
}

/**
 * The /task card: one task, laid out for the row above the prompt.
 */
export interface TaskCard {
  id: string;
  title: string;
  status: string;
  priority?: string;
  project?: string;
  due?: { label: string; daysLate: number };
  /** The description's first paragraph as plain text. */
  summary?: string;
  checklist?: { done: number; total: number };
  href: string;
}

declare module 'claude-code' {
  interface PluginState {
    agentlayer: {
      syncRun: SyncRun | null;
      delivered: string[];
      manualsThisTurn: string[];
      todayBand: TodayView | null;
      sessionBand: string | null;
      reportsBand: ReportRow[] | null;
      syncTick: number;
      notices: Notice[];
      noticeActing: NoticeActing | null;
      queue: Queue;
      heartbeat: HeartbeatClock;
      heartbeatRedraw: number;
      needsSetup: boolean;
      taskCard: TaskCard | null;
    };
  }
}
