import { extname, join, resolve } from 'node:path';
import type { Persona, ProjectLoad, StatusSnapshot, SurfaceLink } from '@/status/collect';
import { projectHue } from '@/status/html-primitives';
import { SCHEMA, type HomeEntry, type PinnedLink } from './sidebar/data';

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

const PIN_KINDS: Readonly<Record<string, PinnedLink['kind']>> = { '.md': 'md', '.html': 'html' };

export const homeEntry = (source: EntrySource, launcher: string): HomeEntry => ({
  schema: SCHEMA,
  name: source.persona.name,
  emoji: source.persona.emoji,
  launcher,
  roadmap: source.surfaces.some((link) => link.href === join(source.runtime.home, 'roadmap.html')),
  // The dashboard orders projects by recent activity; that order would rewrite the file on every task change.
  projects: source.tasks.byProject
    .map(({ project }) => ({ slug: project, hue: projectHue(project, source.projectHues) }))
    .sort((a, b) => a.slug.localeCompare(b.slug)),
  pinned: source.pinned.flatMap(({ title, href }) => {
    const kind = PIN_KINDS[extname(href)];
    return kind ? [{ title, path: resolve(source.runtime.home, href), kind }] : [];
  })
});
