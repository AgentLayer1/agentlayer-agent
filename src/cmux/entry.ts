import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Persona, ProjectLoad, StatusSnapshot, SurfaceLink } from '@/status/collect';
import { projectHue } from '@/status/html-primitives';
import { SCHEMA, type HomeEntry, type Link } from './sidebar/data';

/**
 * The slice of a dashboard snapshot the sidebar reads. Narrow on purpose: nothing that changes per session fits.
 */
export interface EntrySource {
  runtime: Pick<StatusSnapshot['runtime'], 'home'>;
  persona: Pick<Persona, 'name' | 'emoji'>;
  projectHues: Readonly<Record<string, number>>;
  surfaces: readonly Pick<SurfaceLink, 'href'>[];
  pinned: readonly Pick<SurfaceLink, 'title' | 'href'>[];
  tasks: { byProject: readonly Pick<ProjectLoad, 'project'>[] };
}

export interface EntrySettings {
  launcher: string;
  /**
   * The home's projects folder, which `AGENT_PROJECTS` can move out of the home.
   */
  projectsDir: string;
}

const fileUrl = (path: string): string => pathToFileURL(path).href;

const linkTo = (title: string, path: string): Link[] => {
  const kind = extname(path);
  return kind === '.md'
    ? [{ title, kind: 'md', target: path }]
    : kind === '.html'
      ? [{ title, kind: 'html', target: fileUrl(path) }]
      : [];
};

export const homeEntry = (source: EntrySource, settings: EntrySettings): HomeEntry => {
  const home = source.runtime.home;
  const roadmap = join(home, 'roadmap.html');
  return {
    schema: SCHEMA,
    name: source.persona.name,
    emoji: source.persona.emoji,
    launcher: settings.launcher,
    dashboard: fileUrl(join(home, 'dashboard.html')),
    roadmap: source.surfaces.some((link) => link.href === roadmap) ? fileUrl(roadmap) : null,
    // The dashboard orders projects by recent activity; that order would rewrite the file on every task change.
    projects: source.tasks.byProject
      .map(({ project }) => ({
        slug: project,
        hue: projectHue(project, source.projectHues),
        readme: join(settings.projectsDir, project, 'README.md')
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
    pinned: source.pinned.flatMap(({ title, href }) => linkTo(title, resolve(home, href)))
  };
};
