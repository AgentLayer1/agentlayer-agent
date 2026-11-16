/**
 * The entry format's version. A sidebar shows an entry with another schema as "update this agent".
 */
export const SCHEMA = 1;

/**
 * Something the sidebar opens: a note by its absolute path, or an HTML page by its `file://` URL.
 */
export interface Link {
  title: string;
  kind: 'md' | 'html';
  target: string;
}

interface ProjectLink {
  slug: string;
  hue: number;
  /**
   * Absolute path of the project's README.
   */
  readme: string;
}

/**
 * What the sidebar knows about one home: only what changes when a project, pin or setting does.
 */
export interface HomeEntry {
  schema: number;
  name: string;
  emoji: string;
  launcher: string;
  /**
   * `file://` URL of the home's dashboard.html, which deep-links a page by its hash.
   */
  dashboard: string;
  /**
   * `file://` URL of the home's roadmap.html, or `null` when it has none.
   */
  roadmap: string | null;
  projects: ProjectLink[];
  pinned: Link[];
}

export interface SidebarData {
  /**
   * Keyed by the home's absolute path.
   */
  homes: Record<string, HomeEntry>;
}
