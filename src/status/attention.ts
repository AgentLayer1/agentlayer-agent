/**
 * Attention: one engineer's priorities for today, this week and this month. The home view spans every
 * project and is the dashboard's Today tab; a project page (`projects/<slug>/attention.html`) holds that
 * project alone and re-renders on every dashboard rebuild once it exists. Tasks and goals are read
 * live; the queue comes from the snapshot the attention skill writes per scope, because it needs the
 * network.
 */
import { FILES, FOLDERS, MARKDOWN_URL, TIMEZONE } from '@/config';
import { plainText, readRoadmapFile, roadmapMilestones, type RoadmapMilestone, type RoadmapRead } from '@/roadmap/data';
import { agentDisplayName } from '@/shared/agent-name';
import { nowTime, todayDate } from '@/shared/date';
import { createLogger } from '@/shared/log';
import { writeFileAtomic } from '@/shared/utils';
import { HORIZON_BUCKETS, horizonBucket, horizonWithin, isoWeekOf, type HorizonBucket } from '@/tasks/horizon';
import { PROJECT_SLUG, isProject } from '@/tasks/scan';
import type { Work, WorkTask } from '@/work/model';
import { taskOrder } from '@/work/order';
import { hueBySlug, isClosed } from '@/work/views';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { z } from 'zod';
import { boldField, collectGoals, operatorGithubLogin } from './collect';
import {
  AttentionSnapshotSchema,
  type AttentionGroup,
  type AttentionMilestone,
  type AttentionSnapshot,
  type AttentionTask,
  type AttentionView
} from './attention-data';
import { renderAttentionHtml } from './attention-render';
import type { PinLink } from './surfaces';
import { titleize } from './format';

const log = createLogger('status.attention');

/** A roadmap page feeding this attention page; `linkedOnly` keeps just milestones naming one of the page's project tasks. */
export interface AttentionRoadmapSource {
  source: string;
  read: RoadmapRead;
  linkedOnly: boolean;
}

/** The data plus what only the renderer needs: the home and opener to link task files. */

export interface AttentionInputs {
  /** Project slug for a project page; '' for the home page. */
  project: string;
  home: string;
  /** Active and archived tasks: sync archives done work, which still counts toward its period. */
  tasks: readonly WorkTask[];
  goals: { daily: string[]; weekly: string[]; monthly: string[] };
  roadmaps: AttentionRoadmapSource[];
  /** The project README's live pins; none on the home page, whose pins are the sidebar's. */
  pins: PinLink[];
  snapshot: AttentionSnapshot | null;
  /** Lowercased assignee names that mean "the operator". */
  self: Set<string>;
  operator: string;
  today: string;
  generatedAt: string;
  markdownUrl: string;
  projectHues: Readonly<Record<string, number>>;
  timeZone: string;
}

const byUrgency = (a: AttentionTask, b: AttentionTask): number =>
  taskOrder(a, b) || a.horizon.localeCompare(b.horizon);

const toAttentionTask = (task: WorkTask): AttentionTask => {
  const { id, title, priority, project, status, due, updated, horizon, blockedBy, path } = task;
  return { id, title, priority, project, status, due, updated, horizon, blockedBy, path };
};

const isMine = (task: WorkTask, self: Set<string>): boolean =>
  task.assignee.length === 0 || task.assignee.some((name) => self.has(name.toLowerCase()));

const emptyLanes = (): Record<HorizonBucket, AttentionTask[]> => ({
  carried: [],
  today: [],
  week: [],
  month: [],
  later: []
});

const milestoneState = (
  items: { status: string }[],
  window: AttentionMilestone['window'],
  today: string
): AttentionMilestone['state'] | null => {
  if (items.every((item) => item.status === 'done')) {
    return null;
  }
  if (window && window.end < today) {
    return 'slipped';
  }
  return items.some((item) => item.status === 'progress') || (window && window.start <= today) ? 'now' : null;
};

const roadmapNotice = ({ source, read }: AttentionRoadmapSource, milestones: RoadmapMilestone[]): string[] => {
  if (read.kind === 'legacy') {
    return [`${source} still keeps its data in a script, so it can't feed this page yet: ask /roadmap to convert it.`];
  }
  if (read.kind === 'invalid') {
    return [`${source} has a roadmap-data block that isn't valid JSON (${read.error}).`];
  }
  return [
    ...(milestones.some((milestone) => milestone.window)
      ? []
      : [`${source} has no dates, so only its in-progress items show here. /roadmap can date it.`]),
    ...(milestones.length && !milestones.some((milestone) => milestone.taskIds.length)
      ? [`${source} names no task ids, so attention can't tell which tasks move its milestones. /roadmap can add them.`]
      : [])
  ];
};

/** The pull time in the operator's zone, with the day when it wasn't today. */
const pulledAt = (fetchedAt: string, today: string, timeZone: string): AttentionView['queuePulled'] => {
  const pulled = new Date(fetchedAt);
  if (Number.isNaN(pulled.getTime())) {
    return { day: '', time: fetchedAt };
  }
  const sameDay = pulled.toLocaleDateString('sv-SE', { timeZone }) === today;
  return {
    day: sameDay ? '' : pulled.toLocaleDateString('en-GB', { timeZone, weekday: 'short', day: 'numeric' }),
    time: pulled.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' })
  };
};

const buildRoadmap = (inputs: AttentionInputs): AttentionView['roadmap'] => {
  const byId = new Map(inputs.tasks.map((task) => [task.id, toAttentionTask(task)]));
  const projectIds = new Set(inputs.tasks.filter((task) => task.project === inputs.project).map((task) => task.id));
  const walked = inputs.roadmaps.map((roadmap) => ({
    roadmap,
    all: roadmap.read.kind === 'data' ? roadmapMilestones(roadmap.read.data) : []
  }));
  const milestones = walked.flatMap(({ roadmap: { source, linkedOnly }, all }) => {
    const linksTasks = all.some((milestone) => milestone.taskIds.length > 0);
    return all
      .filter((milestone) => !linkedOnly || milestone.taskIds.some((id) => projectIds.has(id)))
      .flatMap((milestone) => {
        const state = milestoneState(milestone.items, milestone.window, inputs.today);
        if (!state) {
          return [];
        }
        const tasks = milestone.taskIds.flatMap((id) => byId.get(id) ?? []);
        return [
          {
            chip: milestone.chip,
            title: plainText(milestone.title),
            section: plainText(milestone.section),
            state,
            window: milestone.window,
            done: milestone.items.filter((item) => item.status === 'done').length,
            total: milestone.items.length,
            inProgress: milestone.items
              .filter((item) => item.status === 'progress')
              .map((item) => plainText(item.text)),
            tasks,
            gap: linksTasks && !tasks.some((task) => !isClosed(task.status)),
            source
          }
        ];
      });
  });
  return {
    milestones: [
      ...milestones.filter((item) => item.state === 'slipped'),
      ...milestones.filter((item) => item.state === 'now')
    ],
    notices: walked
      .filter(({ roadmap }) => !roadmap.linkedOnly)
      .flatMap(({ roadmap, all }) => roadmapNotice(roadmap, all))
  };
};

export const buildAttentionView = (inputs: AttentionInputs): AttentionView => {
  const mine = inputs.tasks.filter(
    (task) => isMine(task, inputs.self) && (!inputs.project || task.project === inputs.project)
  );
  const bucketed = mine.map((task) => ({
    task: toAttentionTask(task),
    bucket: horizonBucket(task.horizon, inputs.today)
  }));
  const lanes = emptyLanes();
  const done: AttentionView['done'] = { today: [], week: [], month: [] };
  bucketed.forEach(({ task, bucket }) => {
    if (!bucket) {
      return;
    }
    if (!isClosed(task.status)) {
      lanes[bucket].push(task);
    } else if (task.status === 'done' && (bucket === 'today' || bucket === 'week' || bucket === 'month')) {
      done[bucket].push(task);
    }
  });
  const isDue = (task: AttentionTask): boolean => Boolean(task.due) && task.due <= inputs.today;
  const unplanned = bucketed.filter(({ task, bucket }) => !bucket && !isClosed(task.status)).map(({ task }) => task);
  const dueUnplanned = [...unplanned, ...lanes.later].filter(isDue).sort(byUrgency);
  lanes.later = lanes.later.filter((task) => !isDue(task));
  HORIZON_BUCKETS.forEach((bucket) => lanes[bucket].sort(byUrgency));
  const plannedIn = (span: 'week' | 'month') => {
    const inSpan = bucketed
      .map(({ task }) => task)
      .filter((task) => task.status !== 'cancelled' && horizonWithin(task.horizon, span, inputs.today));
    return {
      open: inSpan.filter((task) => !isClosed(task.status)).sort(byUrgency),
      done: inSpan.filter((task) => task.status === 'done')
    };
  };
  return {
    schema: 1,
    home: inputs.home,
    operator: inputs.operator,
    project: inputs.project,
    scopeLabel: inputs.project ? titleize(inputs.project) : inputs.operator || 'you',
    today: inputs.today,
    week: isoWeekOf(inputs.today),
    generatedAt: inputs.generatedAt,
    lanes,
    done,
    planned: { week: plannedIn('week'), month: plannedIn('month') },
    dayGoals: inputs.project ? [] : inputs.goals.daily,
    weekGoals: inputs.project ? [] : inputs.goals.weekly,
    monthGoals: inputs.project ? [] : inputs.goals.monthly,
    unplanned: unplanned.filter((task) => !isDue(task)).sort(byUrgency),
    dueUnplanned,
    roadmap: buildRoadmap(inputs),
    pins: inputs.pins,
    snapshot: inputs.snapshot,
    markdownUrl: inputs.markdownUrl,
    projectHues: inputs.projectHues,
    queuePulled: inputs.snapshot ? pulledAt(inputs.snapshot.fetchedAt, inputs.today, inputs.timeZone) : null
  };
};

const readJson = <T>(path: string, schema: z.ZodType<T>): T | null => {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(path, 'utf-8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** A project slug, checked before it becomes a path; '' is the home scope, which lives in the dashboard. */
const checkedProject = (project: string): string => {
  if (project && !isProject(project)) {
    throw new Error(`Unknown project: ${project} (directory not found under ${FOLDERS.PROJECTS})`);
  }
  return project;
};

/** A project's own attention page; the home scope has none, it is the dashboard's Today view. */
export const attentionPagePath = (project: string): string => {
  if (!project) {
    throw new Error('The home attention view lives in the dashboard; only a project has its own attention page');
  }
  return resolve(FOLDERS.PROJECTS, checkedProject(project), 'attention.html');
};

const queuePath = (project: string): string =>
  resolve(FOLDERS.ATTENTION_QUEUES, project ? `queue.${checkedProject(project)}.json` : 'queue.json');

export const readAttentionQueue = (project = ''): AttentionSnapshot | null => readJson(queuePath(project), AttentionSnapshotSchema);

export const saveAttentionQueue = (project: string, groups: AttentionGroup[]): AttentionSnapshot => {
  const snapshot = { fetchedAt: new Date().toISOString(), groups };
  writeFileAtomic(queuePath(project), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
};

const selfNames = (operator: string, github: string): Set<string> =>
  new Set(
    ['user', agentDisplayName(), operator.split(/\s+/)[0] ?? '', github.replace(/[`*]/g, '')]
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  );

const roadmapSources = (project: string): AttentionRoadmapSource[] =>
  [
    ...(project ? [{ path: resolve(FOLDERS.PROJECTS, project, 'roadmap.html'), linkedOnly: false }] : []),
    { path: FILES.ROADMAP, linkedOnly: Boolean(project) }
  ].flatMap(({ path, linkedOnly }) => {
    const read = readRoadmapFile(path);
    return read ? [{ source: relative(FOLDERS.HOME, path), read, linkedOnly }] : [];
  });

/** The live view of one page: tasks and roadmaps from the work model, goals read now, the queue from its last pull. */
export const collectAttentionView = (project: string, work: Work): AttentionView => {
  const operator = boldField(FILES.USER, 'Name');
  const goals = collectGoals();
  return buildAttentionView({
    project: checkedProject(project),
    tasks: work.tasks,
    goals: { daily: goals.daily, weekly: goals.weekly, monthly: goals.monthly },
    roadmaps: roadmapSources(project),
    pins: work.projects.find((item) => item.slug === project)?.pins ?? [],
    snapshot: readAttentionQueue(project),
    self: selfNames(operator, operatorGithubLogin()),
    operator,
    today: todayDate(),
    generatedAt: nowTime(),
    home: FOLDERS.HOME,
    markdownUrl: MARKDOWN_URL,
    projectHues: hueBySlug(work),
    timeZone: TIMEZONE
  });
};

/** Render a project's attention page, creating it on first call. */
export const writeAttentionPage = (project: string, work: Work): { path: string; bytes: number; view: AttentionView } => {
  const view = collectAttentionView(project, work);
  const html = renderAttentionHtml(view);
  const path = attentionPagePath(project);
  writeFileAtomic(path, html);
  return { path, bytes: Buffer.byteLength(html), view };
};

/** Rebuild hook: re-render every page the attention skill has created from the rebuild's model, never throw. */
export const writeAttentionPagesSafe = (work: Work): void => {
  work.projects
    .filter((project) => project.attention && PROJECT_SLUG.test(project.slug))
    .map((project) => project.slug)
    .forEach((project) => {
      try {
        writeAttentionPage(project, work);
      } catch (err) {
        log.warn(`attention page rebuild failed for ${project}`, err);
      }
    });
};
