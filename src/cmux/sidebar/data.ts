export const SCHEMA = 1;

export interface ProjectLink {
  slug: string;
  hue: number;
}

export interface PinnedLink {
  title: string;
  path: string;
  kind: 'md' | 'html';
}

/**
 * What the sidebar knows about one home: only what changes when a project, pin or setting does.
 */
export interface HomeEntry {
  name: string;
  emoji: string;
  launcher: string;
  roadmap: boolean;
  projects: ProjectLink[];
  pinned: PinnedLink[];
}

export interface SidebarFile {
  schema: number;
  /**
   * Keyed by the home's absolute path.
   */
  homes: Record<string, HomeEntry>;
}
