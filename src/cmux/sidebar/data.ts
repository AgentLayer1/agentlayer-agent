/**
 * The entry format's version. A sidebar shows an entry with another schema as "update this agent".
 */
export const SCHEMA = 4;

export interface TaskItem {
  id: string;
  title: string;
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
  /**
   * The project's live tasks: active, then blocked, then open; by priority, then due date.
   */
  tasks: TaskItem[];
}

/**
 * What the sidebar knows about one home, rewritten whenever a project or one of its live tasks changes.
 */
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
  target: PinTarget;
}

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
}

export interface SidebarData {
  /**
   * Keyed by the home's absolute path.
   */
  homes: Record<string, HomeEntry>;
}
