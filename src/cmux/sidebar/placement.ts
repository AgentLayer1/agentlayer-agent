/*
 * Which cmux workspace a session the sidebar opens belongs in. Imports nothing, so the sidebar's bundle can include it
 * and bun can test it.
 */

export interface PlaceWorkspace {
  id: string;
  title: string;
  description?: string;
  directory: string;
  selected: boolean;
  group?: string;
  remote?: unknown;
  latestAt?: number;
  tabs: readonly { directory?: string; surfaceId?: string }[];
}

/**
 * An agent as the choice knows it: its name, its home, the code folders it works in, and its heartbeat's tab.
 */
export interface PlaceAgent {
  name: string;
  home: string;
  folders: readonly string[];
  heartbeatSurface?: string;
}

/**
 * What the session is about. `workspace` is a title the agent picked, `folders` where the work lives, `names` what it
 * is called (a project's slug and title), and `words` everything else that describes it.
 */
export interface WorkHint {
  workspace?: string;
  folders?: readonly string[];
  names?: readonly string[];
  words?: string;
}

export type Placement = { kind: 'workspace'; id: string } | { kind: 'new' };

/**
 * Where a session goes when no workspace fits the work: the agent's own workspace first, or the focused one first.
 */
export type Fallback = 'agent' | 'selected';

const PICKED = 100;
const IN_FOLDER = 90;
const SAME_NAME = 80;
const NAME_INSIDE = 70;
const WORDS = 60;
const ONE_WORD = 50;
const MIN_INSIDE = 4;

const STOP = new Set(
  'a an and the or of to in on for with from by at as is it its my your our this that be do new'.split(' ')
);
// Words too common in workspace titles to place a session by one of them alone.
const GENERIC = new Set(['agent', 'issu', 'work', 'task', 'session', 'run', 'chat', 'misc', 'group']);

const flat = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

// A light stem, enough that reviews meets review and investigating meets investigate.
const stem = (word: string): string => {
  const base = word.length > 5 && word.endsWith('ing') ? word.slice(0, -3) : word;
  const single = base.length > 3 && base.endsWith('s') && !base.endsWith('ss') ? base.slice(0, -1) : base;
  return single.length > 4 && single.endsWith('e') ? single.slice(0, -1) : single;
};

const stems = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1 && !STOP.has(word))
      .map(stem)
  );

// cmux reports POSIX paths; the trailing separator keeps /repo from claiming /repo-other.
const isInside = (directory: string, folder: string): boolean =>
  folder !== '' && (directory === folder || directory.startsWith(folder.endsWith('/') ? folder : `${folder}/`));

const directoriesOf = (workspace: PlaceWorkspace): string[] =>
  [workspace.directory, ...workspace.tabs.map((tab) => tab.directory ?? '')].filter(Boolean);

const holdsHeartbeat = (workspace: PlaceWorkspace, agent: PlaceAgent): boolean =>
  agent.heartbeatSurface !== undefined && workspace.tabs.some((tab) => tab.surfaceId === agent.heartbeatSurface);

/**
 * The agent's own workspace: the one titled `Agent <Name>`, else one opened in its home, preferring one without the
 * heartbeat's tab.
 */
const anchorOf = (workspaces: readonly PlaceWorkspace[], agent: PlaceAgent): PlaceWorkspace | undefined =>
  workspaces.find((workspace) => flat(workspace.title) === flat(`agent ${agent.name}`)) ??
  workspaces
    .filter((workspace) => workspace.directory === agent.home)
    .toSorted((a, b) => Number(holdsHeartbeat(a, agent)) - Number(holdsHeartbeat(b, agent)))[0];

// An agent's anchor is its own, and so is the group it sits in, unless another agent's anchor shares that group.
const claimedBy = (
  workspace: PlaceWorkspace,
  anchor: PlaceWorkspace | undefined,
  rivals: readonly (PlaceWorkspace | undefined)[]
): boolean =>
  anchor !== undefined &&
  (workspace.id === anchor.id ||
    (anchor.group !== undefined &&
      workspace.group === anchor.group &&
      !rivals.some((rival) => rival !== undefined && rival.id !== anchor.id && rival.group === anchor.group)));

const worksIn = (workspace: PlaceWorkspace, agent: PlaceAgent): boolean =>
  directoriesOf(workspace).some((directory) =>
    [agent.home, ...agent.folders].some((folder) => isInside(directory, folder))
  );

const scoreOf = (workspace: PlaceWorkspace, hint: WorkHint, home: string): number => {
  const title = flat(workspace.title);
  const folders = (hint.folders ?? []).filter((folder) => folder !== '' && folder !== home);
  const names = (hint.names ?? []).map(flat).filter(Boolean);
  const own = stems(`${workspace.title} ${workspace.description ?? ''}`);
  const shared = [...stems(`${hint.words ?? ''} ${(hint.names ?? []).join(' ')} ${hint.workspace ?? ''}`)].filter(
    (word) => own.has(word)
  );
  const distinct = shared.filter((word) => !GENERIC.has(word) && word.length >= 3);
  const scores = [
    hint.workspace && flat(hint.workspace) === title ? PICKED : 0,
    folders.some((folder) => directoriesOf(workspace).some((directory) => isInside(directory, folder))) ? IN_FOLDER : 0,
    names.includes(title) ? SAME_NAME : 0,
    names.some((name) => Math.min(name.length, title.length) >= MIN_INSIDE && (name.includes(title) || title.includes(name)))
      ? NAME_INSIDE
      : 0,
    shared.length >= 2 && distinct.length >= 1 ? WORDS : 0,
    distinct.length >= 1 ? ONE_WORD : 0
  ];
  return Math.max(...scores);
};

/**
 * Where a session for `hint` opens: the agent's workspace that best fits the work, else (by `fallback`) the agent's own
 * workspace and the selected one when it isn't another agent's, else a new workspace. Remote workspaces can't take
 * startup input, so they never qualify.
 */
export const placeFor = (
  workspaces: readonly PlaceWorkspace[],
  agent: PlaceAgent,
  others: readonly PlaceAgent[],
  hint: WorkHint,
  fallback: Fallback = 'agent'
): Placement => {
  const local = workspaces.filter((workspace) => !workspace.remote);
  const anchor = anchorOf(local, agent);
  const otherAnchors = others.map((other) => anchorOf(local, other));
  const allAnchors = [anchor, ...otherAnchors];
  const isTheirs = (workspace: PlaceWorkspace): boolean =>
    otherAnchors.some((other) => other?.id === workspace.id) ||
    (!claimedBy(workspace, anchor, allAnchors) &&
      (otherAnchors.some((other) => claimedBy(workspace, other, allAnchors)) ||
        others.some((other) => worksIn(workspace, other) && !worksIn(workspace, agent))));
  const mine = local.filter(
    (workspace) => !isTheirs(workspace) && (claimedBy(workspace, anchor, allAnchors) || worksIn(workspace, agent))
  );
  const choices = mine.filter((workspace) => !holdsHeartbeat(workspace, agent) || mine.length === 1);
  const best = choices
    .map((workspace) => ({ workspace, score: scoreOf(workspace, hint, agent.home) }))
    .filter(({ score }) => score >= ONE_WORD)
    .toSorted((a, b) => b.score - a.score || (b.workspace.latestAt ?? 0) - (a.workspace.latestAt ?? 0))[0];
  const selected = local.find((workspace) => workspace.selected && !isTheirs(workspace));
  const target = best?.workspace ?? (fallback === 'selected' ? (selected ?? anchor) : (anchor ?? selected));
  return target ? { kind: 'workspace', id: target.id } : { kind: 'new' };
};
