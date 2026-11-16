import { join } from 'node:path';
import type { EntrySource } from '../entry';

const NOVA_HOME = join('/Users', 'ada', 'Documents', 'Agents', 'Nova');
const SCOUT_HOME = join('/Users', 'ada', 'Documents', 'Agents', 'Scout');

/**
 * An invented home with projects, pins and a roadmap.
 */
export const NOVA: EntrySource = {
  runtime: { home: NOVA_HOME },
  persona: { name: 'Nova', emoji: '🦉' },
  projectHues: { 'acme-app': 210 },
  surfaces: [{ href: join(NOVA_HOME, 'roadmap.html') }, { href: 'projects/acme-app/dashboard.html' }],
  pinned: [
    { title: 'Support playbook', href: join(NOVA_HOME, 'reports', 'plans', 'support-playbook.md') },
    { title: 'Q4 review', href: join(NOVA_HOME, 'reports', 'briefings', 'q4-review.html') }
  ],
  tasks: { byProject: [{ project: 'garden-shop' }, { project: 'acme-app' }, { project: 'blog' }] }
};

/**
 * An invented home with no projects, pins or roadmap.
 */
export const SCOUT: EntrySource = {
  runtime: { home: SCOUT_HOME },
  persona: { name: 'Scout', emoji: '🐢' },
  projectHues: {},
  surfaces: [],
  pinned: [],
  tasks: { byProject: [] }
};
