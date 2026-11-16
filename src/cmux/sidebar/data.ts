/**
 * The entry format's version. A sidebar shows an entry with another schema as "update this agent".
 */
export const SCHEMA = 6;

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
   * The project the goal's title opened with (`acme-app: …`), which the title then drops.
   */
  project: { slug: string; hue: number } | null;
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

/**
 * What the sidebar knows about one home, rewritten whenever its projects, tasks, pins, reports or goals change.
 */
export interface HomeEntry {
  schema: number;
  name: string;
  emoji: string;
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
  goals: GoalsItem;
}

export interface SidebarData {
  /**
   * Keyed by the home's absolute path.
   */
  homes: Record<string, HomeEntry>;
}
