import type { AgentColors } from '../../shared/persona';

/**
 * The entry format's version. A sidebar shows an entry with another schema as "update this agent".
 */
export const SCHEMA = 11;

export interface TaskItem {
  id: string;
  title: string;
  /**
   * The slug of the project it belongs to.
   */
  project: string;
  status: string;
  priority: string;
  /**
   * `YYYY-MM-DD`, or `''` when the task has no due date. The sidebar words it against today's date.
   */
  due: string;
  /**
   * Entries in the task's thread, as the dashboard counts them.
   */
  comments: number;
  /**
   * Absolute path of the task file.
   */
  path: string;
}

/**
 * Where a pin opens: an HTML page in a browser tab, anything else as a file.
 */
export type PinTarget = { kind: 'page'; url: string } | { kind: 'file'; path: string };

export interface PinItem {
  title: string;
  icon: string;
  target: PinTarget;
}

export interface ProjectCard {
  slug: string;
  hue: number;
  active: number;
  open: number;
  blocked: number;
  done: number;
  /**
   * `file://` URL of the project's own roadmap.html, or `null` when it has none.
   */
  roadmap: string | null;
  /**
   * The pins in the project README.
   */
  pins: PinItem[];
}

export interface ReportItem {
  title: string;
  /**
   * The skill that wrote it, or its folder when no skill is recorded.
   */
  kind: string;
  /**
   * The hue the dashboard gives `kind`'s chip.
   */
  hue: number;
  /**
   * `YYYY-MM-DD` and `HH:MM`; the sidebar words the day against today.
   */
  date: string;
  time: string;
  /**
   * clean, findings, critical or draft; '' when the report has none.
   */
  status: string;
  target: PinTarget;
}

/**
 * A file in the home that changed lately: a task, a report, a project page, a knowledge article.
 */
export interface RecentItem {
  title: string;
  /**
   * What sort of file it is (`task`, `roadmap`, a report's kind), and the hue its chip takes.
   */
  kind: string;
  hue: number;
  /**
   * The slug of the project it sits in, '' when none.
   */
  project: string;
  /**
   * `YYYY-MM-DD` and `HH:MM` it last changed; the sidebar words the day against today.
   */
  date: string;
  time: string;
  target: PinTarget;
}

export interface GoalItem {
  /**
   * Its place in its block, from 1.
   */
  number: number;
  /**
   * A quarter (`Q4`) on a yearly goal, '' otherwise.
   */
  label: string;
  /**
   * The quarter's score, ✅ ❌ 🟡 or ↪, '' when unscored.
   */
  mark: string;
  title: string;
  /**
   * What counts as done, '' when the goal doesn't say.
   */
  check: string;
  detail: string;
  /**
   * The slug of the project the goal's title opened with (`acme-app: …`), which the title then drops; '' when none.
   */
  project: string;
}

export interface GoalBlockItem {
  horizon: 'day' | 'week' | 'month' | 'year';
  /**
   * The day a daily block is for, or the Monday a weekly one starts; '' otherwise.
   */
  date: string;
  /**
   * The month a monthly block names (`November 2026`), '' otherwise.
   */
  caption: string;
  goals: GoalItem[];
  /**
   * The block's other lines: what its intro says beyond the caption, then what follows the goals.
   */
  notes: string[];
}

export interface GoalsItem {
  /**
   * The year's theme, as the yearly block's intro names it (`2026 theme: …`).
   */
  theme: { label: string; text: string } | null;
  blocks: GoalBlockItem[];
}

export interface NoteItem {
  id: string;
  title: string;
  body: string;
  next: string;
  sources: string[];
  /**
   * When it went out, an ISO time with an offset.
   */
  at: string;
  /**
   * When a note put off with Later shows again, an ISO time with an offset; '' when it shows now.
   */
  laterUntil: string;
}

/**
 * A proposal as the sidebar shows it: never its prompt, which stays in the home.
 */
export interface ProposalItem {
  id: string;
  title: string;
  /**
   * What happened that made the agent propose it.
   */
  trigger: string;
  /**
   * The source's own words, '' when none help.
   */
  quote: string;
  detail: string;
  /**
   * What the session may touch.
   */
  reach: string;
  /**
   * How long it should take (`5m`).
   */
  estimate: string;
  /**
   * When it presses (`due Sat`), '' when nothing does.
   */
  due: string;
  /**
   * The folder the work lives in, and the title of the workspace the agent picked for it; '' when none was named.
   */
  folder?: string;
  workspace?: string;
  /**
   * When a proposal put off with Later shows again, an ISO time with an offset; '' when it shows now.
   */
  laterUntil: string;
  /**
   * When it was proposed, an ISO time with an offset.
   */
  at: string;
}

/**
 * The cmux tab of the home's heartbeat session, where the sidebar's buttons type their choice.
 */
export interface HeartbeatPlace {
  surfaceId: string;
  workspaceId: string;
}

/**
 * What the sidebar knows about one home, rewritten whenever its projects, tasks, pins, reports, goals or proposals
 * change.
 */
export interface HomeEntry {
  schema: number;
  /**
   * The home's folder, where a session the sidebar opens starts.
   */
  home: string;
  /**
   * The plugin's name, which prefixes its skills' slash commands.
   */
  plugin: string;
  name: string;
  emoji: string;
  /**
   * The agent's `#RRGGBB` pair from its IDENTITY.md; its chip is drawn in the primary. Absent in an entry an older
   * plugin wrote, which still gets a chip.
   */
  colors?: AgentColors;
  /**
   * `file://` URL of the home's dashboard.html, which deep-links a page by its hash.
   */
  dashboard: string;
  /**
   * `file://` URL of the home's roadmap.html, or `null` when it has none.
   */
  roadmap: string | null;
  projects: ProjectCard[];
  /**
   * Every live task by priority, then due date, then the most recently updated; a project's card shows its own.
   */
  tasks: TaskItem[];
  /**
   * The home's own pins (reports/pinned.md); each project's ride on its card.
   */
  pins: PinItem[];
  /**
   * The newest reports, at most REPORT_LIMIT of them.
   */
  reports: ReportItem[];
  /**
   * How many older reports were left out, which the dashboard still lists.
   */
  olderReports: number;
  /**
   * The files changed lately, newest first; absent in an entry an older plugin wrote.
   */
  recent?: RecentItem[];
  goals: GoalsItem;
  /**
   * What the open tasks add up to, as sync or the heartbeat last wrote it in TASKS.md; null when none is written.
   */
  tasksSummary: { text: string; writtenAt: string } | null;
  /**
   * Every proposal still to decide, oldest first, those put off included; the sidebar hides those against its clock.
   */
  proposals: ProposalItem[];
  /**
   * The notes still waiting on the operator, newest first; absent in an entry an older plugin wrote.
   */
  notes?: NoteItem[];
  /**
   * `file://` URL of the folder each Agents tab section shows, for its Finder button; absent in an older entry.
   */
  folders?: Record<'projects' | 'reports' | 'recent', string>;
  heartbeat: HeartbeatPlace | null;
  /**
   * What starts Claude in this home: `agent` when it bills its own subscription, else `claude`.
   */
  launcher: 'agent' | 'claude';
  /**
   * The code checkouts this home works in, which mark a workspace opened there as this agent's. Absent in an entry an
   * older plugin wrote.
   */
  codeFolders?: string[];
}

export interface StartPage {
  tab: 'manager' | 'agents';
  section?: 'projects' | 'reports' | 'recent' | 'goals';
  /**
   * Cards that start open: `tasks` for the Tasks card, or a project's slug.
   */
  expanded?: string[];
}

export interface SidebarData {
  /**
   * Keyed by the home's absolute path.
   */
  homes: Record<string, HomeEntry>;
  /**
   * The page to open on; only a preview sets it, so a screenshot can show any page. Absent, the Manager.
   */
  open?: StartPage;
}
