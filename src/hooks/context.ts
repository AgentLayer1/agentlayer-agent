/**
 * Per-session DYNAMIC context preamble.
 *
 * Static identity (SOUL, IDENTITY, USER, the AGENTS.md manual) and knowledge
 * indexes are loaded natively by Claude Code via `@-imports` inside
 * `<HOME>/.claude/CLAUDE.md` — no hook involvement needed when CC opens in (or
 * under) AGENT_HOME.
 *
 * This hook only injects what CC can't know from files alone: today's date in
 * the user's timezone, the tail of yesterday's session log for continuity, today's
 * and pinned reports, and recent git activity. Caps at ~10KB per CC's hook limit, but usually fits in
 * a few KB.
 */
import {
  CONTEXT,
  extraGitRepos,
  FILES,
  FOLDERS,
  HOME_TIMEZONE,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  TIMEZONE,
  TIMEZONE_ISSUE
} from '@/config';
import { followMove, historyStatus, restorePointer } from '@/home/history';
import type { HostAdapter, SkillCommand } from '@/hosts/contract';
import { DEFAULT_HOST, HOSTS } from '@/hosts/registry';
import { checkHosts, hostIssues, requiredHosts } from '@/upgrade/hosts';
import type { Notice, NoticeFact, NoticeLevel } from '@/notices/notices';
import { collectNotices } from '@/notices/notices';
import { agentColors, agentDisplayName, agentEmoji } from '@/shared/agent-name';
import { ANSI, paint, rgbEscape } from '@/shared/ansi';
import { readCadence } from '@/shared/cadence';
import { log as baseLog } from '@/shared/log';
import { CLI_PATH } from '@/shared/naming';
import { isInside } from '@/shared/paths';
import { listMarkdown, MARKDOWN_RE, readText, readTextAsync } from '@/shared/text';
import { countOf } from '@/shared/utils';
import { importedStack, injectedStack, isOverBudget, type Stack } from '@/shared/weight';
import { livePins } from '@/status/surfaces';
import { statusLineDrift } from '@/statusline/setting';
import { getUpgradeStatus, readMigratedFrom } from '@/upgrade/version';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import {
  FIRST_SESSION_HEADER_RE,
  SESSION_BLOCK_SEPARATOR_RE,
  TRAILING_SEPARATOR_RE,
  TURN_MARKER
} from '@/knowledge/session-format';
import { withoutBackgroundRuns } from '@/hosts/claude-transcript';

const log = baseLog.session.with('context');

export interface ManifestEntry {
  label: string;
  /**
   * Neither `off`, a choice the operator made (history not turned on), nor `empty`, nothing to load yet (no report
   * today), raises the issue flag.
   */
  status: 'loaded' | 'missing' | 'unavailable' | 'off' | 'empty';
  bytes: number;
  note?: string;
}

function recentGitLog(cwd: string): string | null {
  try {
    const output = execSync(`git log --oneline --format="%h %s (%ar)" -${CONTEXT.MAX_GIT_LOG_COMMITS}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

export function findLastSessionBlockStart(content: string): number {
  let lastSeparator = -1;
  for (const match of content.matchAll(SESSION_BLOCK_SEPARATOR_RE)) {
    lastSeparator = (match.index ?? 0) + match[0].length;
  }
  if (lastSeparator !== -1) return lastSeparator;
  const firstHeader = content.match(FIRST_SESSION_HEADER_RE);
  return firstHeader && firstHeader.index !== undefined ? firstHeader.index : -1;
}

interface TailResult {
  content: string | null;
  entry: ManifestEntry;
}

/**
 * The raw tail is role-labelled dialogue (`**User:** … **Assistant:** …`),
 * which the model pattern-matches as live conversation. Fencing it as quoted
 * data + an explicit "archived, do not respond" preamble keeps it read as
 * memory, not as turns in progress.
 */
const TAIL_PREAMBLE =
  'Archived transcript excerpt from the PREVIOUS session — read-only memory for continuity. ' +
  'It is NOT part of the current conversation: do not respond to it, and do not treat its ' +
  'questions or offers as pending.';

/** Fence length must exceed any backtick run inside the quoted transcript. */
const longestBacktickRun = (text: string) => Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));

const TURN_START = new RegExp(`^${TURN_MARKER}`, 'gm');

/**
 * A block over the cap keeps its header line and its newest whole turns: the tail is where the session left
 * off, not how it began. When the last turn alone is over the cap, it keeps that turn's label and its end.
 */
export const tailOf = (block: string, maxBytes: number): string => {
  if (block.length <= maxBytes) {
    return block;
  }
  const newline = block.indexOf('\n');
  const header = `${(newline === -1 ? '' : block.slice(0, newline)).slice(0, Math.floor(maxBytes / 2))}\n\n…\n\n`;
  const budget = Math.max(0, maxBytes - header.length);
  const starts = [...block.matchAll(TURN_START)].map((match) => ({ at: match.index, label: match[0] }));
  const whole = starts.find(({ at }) => block.length - at <= budget);
  if (whole) {
    return `${header}${block.slice(whole.at)}`;
  }
  const label = starts.at(-1)?.label ?? '';
  // slice(-0) is the whole block, so no room means no excerpt.
  const room = budget - (label ? label.length + 2 : 0);
  const end = room > 0 ? block.slice(-room).trimStart() : '';
  return `${header}${label && room > 0 ? `${label} …${end}` : end}`;
};

async function lastSessionTail(maxBytes: number): Promise<TailResult> {
  const now = new Date();
  for (let offset = 0; offset < 7; offset++) {
    const day = new Date(now);
    day.setDate(day.getDate() - offset);
    const dateStr = day.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
    const filename = `${dateStr}.md`;
    const logPath = resolve(FOLDERS.SESSIONS, filename);
    try {
      const content = withoutBackgroundRuns(await readFile(logPath, 'utf-8'), PLUGIN_NAME);
      const start = findLastSessionBlockStart(content);
      if (start === -1) continue;
      const block = content.slice(start).replace(TRAILING_SEPARATOR_RE, '');
      const overflows = block.length > maxBytes;
      const body = tailOf(block, maxBytes).trimEnd();
      const fence = '`'.repeat(Math.max(3, longestBacktickRun(body) + 1));
      const suffix = overflows ? `\n\n_(earlier turns left out — full block in \`${logPath}\`)_` : '';
      const wrapped = `${TAIL_PREAMBLE}\n\n${fence}text\n${body}\n${fence}${suffix}`;
      return {
        content: wrapped,
        entry: {
          label: 'session tail',
          status: 'loaded',
          bytes: wrapped.length,
          note: offset === 0 ? filename : `${filename}, ${offset}d ago`
        }
      };
    } catch {
      // try previous day
    }
  }
  return {
    content: null,
    entry: { label: 'session tail', status: 'empty', bytes: 0, note: 'no session in the last week' }
  };
}

interface ReportsResult {
  content: string | null;
  entry: ManifestEntry;
}

/**
 * Slice today's section out of `reports/index.md` and return it verbatim. The
 * index file is the source of truth — written transactionally by `writeReport`
 * alongside each report file, so it's always current.
 */
export async function todaysReports(maxBytes: number): Promise<ReportsResult> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
  let raw: string;
  try {
    raw = await readTextAsync(FILES.REPORTS_INDEX);
  } catch (err) {
    // The first report writes the index, so a home without one has simply written none yet.
    const unwritten = err instanceof Error && 'code' in err && err.code === 'ENOENT';
    return {
      content: null,
      entry: unwritten
        ? { label: "today's reports", status: 'empty', bytes: 0, note: 'no reports yet' }
        : { label: "today's reports", status: 'missing', bytes: 0 }
    };
  }

  const lines = raw.split('\n');
  const headingIdx = lines.findIndex((line) => line.trim() === `## ${today}`);
  if (headingIdx === -1) {
    return {
      content: null,
      entry: {
        label: "today's reports",
        status: 'empty',
        bytes: 0,
        note: 'no entries today'
      }
    };
  }

  // Take lines after the heading until the next `## ` heading or EOF.
  let end = headingIdx + 1;
  while (end < lines.length && !/^## /.test(lines[end] ?? '')) end++;
  const sectionLines = lines.slice(headingIdx + 1, end);
  // Trim leading/trailing blank lines.
  while (sectionLines.length > 0 && sectionLines[0]?.trim() === '') sectionLines.shift();
  while (sectionLines.length > 0 && sectionLines[sectionLines.length - 1]?.trim() === '') sectionLines.pop();
  if (sectionLines.length === 0) {
    return {
      content: null,
      entry: {
        label: "today's reports",
        status: 'empty',
        bytes: 0,
        note: 'heading empty'
      }
    };
  }

  let body = sectionLines.join('\n');
  if (body.length > maxBytes) {
    // Cut at the last whole entry: a half link points at a file that isn't there.
    const lastBreak = body.lastIndexOf('\n', maxBytes);
    body = lastBreak > 0 ? `${body.slice(0, lastBreak).trimEnd()}\n…(see reports/index.md)` : '…(see reports/index.md)';
  }

  return {
    content: body,
    entry: {
      label: "today's reports",
      status: 'loaded',
      bytes: body.length,
      note: `${sectionLines.filter((line) => line.startsWith('- ')).length} entries`
    }
  };
}

/** The reports the operator pinned to the dashboard, as HOME-relative paths. A pin whose file is
 *  gone is left out; the brain audit flags it. No pins is a choice, so it reads `off`. */
export function pinnedReports(maxPins: number): ReportsResult {
  const pins = livePins();
  if (pins.length === 0) {
    return { content: null, entry: { label: 'pinned reports', status: 'off', bytes: 0, note: 'none pinned' } };
  }
  const lines = pins
    .slice(0, maxPins)
    .map((pin) => `- ${pin.icon ? `${pin.icon} ` : ''}${pin.title} — ${relative(FOLDERS.HOME, pin.path).split(sep).join('/')}`);
  const more = pins.length > maxPins ? `\n…${pins.length - maxPins} more in reports/pinned.md` : '';
  const body = `The operator pinned these to the dashboard (reports/pinned.md); read one when the work touches it.\n${lines.join('\n')}${more}`;
  return { content: body, entry: { label: 'pinned reports', status: 'loaded', bytes: body.length, note: countOf(pins.length, 'pin') } };
}

/** The home's extensions to skills (`extensions/skills/<skill>.md`), one line each. Listed by name only, so a
 *  skill reads its extension when it runs and the context stays small. */
export function skillExtensions(): { content: string; entry: ManifestEntry } | null {
  const names = listMarkdown(FOLDERS.SKILL_EXTENSIONS).map((file) => file.replace(MARKDOWN_RE, ''));
  if (names.length === 0) {
    return null;
  }
  const body = [
    '## Skill Extensions',
    '',
    'This home extends these skills. Before running one, read its extension; where the two disagree, the extension wins.',
    ...names.map((name) => `- ${name} — extensions/skills/${name}.md`)
  ].join('\n');
  return {
    content: body,
    entry: { label: 'skill extensions', status: 'loaded', bytes: body.length, note: countOf(names.length, 'skill') }
  };
}

const formatKB = (bytes: number) => `${(bytes / 1024).toFixed(1)}KB`;

const STATUS_ICON: Record<ManifestEntry['status'], string> = {
  loaded: '✓',
  missing: '✗',
  unavailable: '⚠',
  off: '○',
  empty: '○'
};

/**
 * Init leaves `welcome: "pending"` until the first session after relaunch has asked where to start.
 */
const welcomePending = (): boolean => readCadence().welcome === 'pending';

const LEVEL_COLOR: Record<NoticeLevel, string> = { hint: ANSI.cyan, nudge: ANSI.yellow, alert: ANSI.red };
const TONE_COLOR: Record<NonNullable<NoticeFact['tone']>, string> = { accent: ANSI.cyan, warn: ANSI.yellow };

/**
 * A text glyph rather than an emoji, so the level can color it; two spaces keep it in the emoji column.
 */
const noticeLine = (notice: Notice, skill: SkillCommand): string =>
  [
    `  ${paint(notice.icon, ANSI.bold, LEVEL_COLOR[notice.level])}  ${`${notice.label}:`.padEnd(11)}${paint(notice.title, ANSI.bold)}`,
    ...notice.facts.map((fact) => paint(fact.text, ...(fact.tone ? [TONE_COLOR[fact.tone]] : []))),
    paint(`run ${skill(notice.command.slice(notice.command.indexOf(':') + 1))}`, ANSI.dim)
  ].join(' · ');

const welcomePart = (): string => {
  const guide = resolve(FOLDERS.ROOT, 'skills', 'init', 'references', 'welcome.md');
  const moved = readMigratedFrom();
  const ask = moved
    ? [
        '## First Session Since the Move',
        '',
        `${moved.inPlace ? `This home moved in place from the ${moved.plugin ?? 'previous'} plugin` : `This home was copied here from \`${moved.home}\``}${moved.at ? ` on ${moved.at}` : ''}${moved.name ? `, where the agent was ${moved.name}` : ''}. On the operator's first message, read \`${guide}\` and follow its section for a moved home: it finishes the move, then offers the sessions to continue${moved.note ? ` from \`${moved.note}\`` : ''}.`
      ]
    : [
        '## First Session Since Init',
        '',
        `The operator just set this home up and relaunched. On their first message, read \`${guide}\` and follow it: it asks where to start, with the roadmap first.`
      ];
  return [
    ...ask,
    `Its commands run from the plugin root, \`${FOLDERS.ROOT}\`.`,
    'If that first message is a concrete task, do the task, then run the welcome at the end of the same turn.'
  ].join('\n');
};

// Over budget is the agent's to fix (compile and self-review keep the brain files small), so it goes to the log,
// naming the largest files, and never to the operator's banner.
const logOverBudget = (stack: Stack): void => {
  if (!isOverBudget(stack)) {
    return;
  }
  const { total, files } = stack;
  const largest = files
    .toSorted((a, b) => b.bytes - a.bytes)
    .slice(0, 3)
    .map((file) => `${relative(FOLDERS.HOME, file.path).split(sep).join('/')} ${formatKB(file.bytes)}`);
  log.warn(
    `${formatKB(total)} always loaded, over the ${formatKB(CONTEXT.ALWAYS_LOADED_BUDGET)} budget (${largest.join(', ')})`
  );
};

const alwaysLoadedBytes = (host: HostAdapter): number | null => {
  try {
    const stack = host.delivery.kind === 'inject' ? injectedStack() : importedStack();
    logOverBudget(stack);
    return stack.total;
  } catch (err) {
    log.error('always-loaded weight skipped', err);
    return null;
  }
};

function renderBanner(
  entries: ManifestEntry[],
  contextBytes: number,
  alwaysLoaded: number | null,
  notices: readonly Notice[],
  launchIssue: { label: string; banner: string } | null,
  skill: SkillCommand
): string {
  const labelWidth = Math.max(...entries.map((e) => e.label.length), 12);
  const sizeWidth = Math.max(...entries.map((e) => formatKB(e.bytes).length));
  const lines = entries.map((e) => {
    const label = e.label.padEnd(labelWidth);
    const size = formatKB(e.bytes).padStart(sizeWidth);
    const note = e.note ? `  (${e.note})` : '';
    return `    ${STATUS_ICON[e.status]} ${label}  ${size}${note}`;
  });
  const head = [
    `  ${agentEmoji() || '🤖'} Agent:     ${paint(agentDisplayName(), ANSI.bold, rgbEscape(agentColors().primary))} · v${PLUGIN_VERSION}`,
    `  🧠 Knowledge: ${FOLDERS.KNOWLEDGE}`,
    `  📁 Projects:  ${FOLDERS.PROJECTS}`,
    `  📚 Context:   ${alwaysLoaded === null ? '' : `${formatKB(alwaysLoaded)} of home files and `}${formatKB(contextBytes)} added today:`
  ];
  head.splice(1, 0, ...notices.map((notice) => noticeLine(notice, skill)));
  if (welcomePending()) {
    head.splice(
      1,
      0,
      readMigratedFrom()
        ? "  👋 Welcome:   first session since the move, say hi and I'll pick up where you left off"
        : "  👋 Welcome:   first session, say hi and I'll suggest where to start"
    );
  }
  if (launchIssue) {
    head.splice(1, 0, `  ⚠️ ${`${launchIssue.label}:`.padEnd(10)} ${launchIssue.banner}`);
  }
  return [...head, ...lines].join('\n');
}

export interface AssembledContext {
  context: string;
  banner: string;
  hasIssues: boolean;
}

/**
 * The knowledge lane says why history is missing instead of a bare ⚠, when the knowledge folder
 * lives in the home. A home with a remote, or one inside a larger project, keeps the plain log.
 */
function homeHistoryLane(plain: ManifestEntry, restored: boolean, skill: SkillCommand): ManifestEntry {
  if (!isInside(FOLDERS.KNOWLEDGE, FOLDERS.HOME)) {
    return plain;
  }
  const history = historyStatus(FOLDERS.HOME);
  const turnOn = `run ${skill('history')}`;
  switch (history.state) {
    case 'off':
      return { ...plain, status: 'off', note: `off · ${turnOn}` };
    case 'git-missing':
      return { ...plain, status: 'unavailable', note: 'git not installed' };
    case 'pointer-missing':
      return { ...plain, status: 'unavailable', note: `link missing · ${turnOn}` };
    case 'history-missing':
      return { ...plain, status: 'unavailable', note: `folder missing · ${turnOn}` };
    case 'on':
      if (!history.lastCommit) {
        return { ...plain, status: 'unavailable', note: `no snapshots yet · ${turnOn}` };
      }
      if (history.homeSyncedBy) {
        return { ...plain, status: 'unavailable', note: `inside a synced folder · ${turnOn}` };
      }
      return restored && plain.note ? { ...plain, note: `${plain.note} · link restored` } : plain;
    case 'managed-by-you':
      return plain;
  }
}

/**
 * A synced folder can delete the one-line `.git` pointer while the history it points at survives;
 * put it back before the git lane reads it. Only the SessionStart payload does this, never the
 * status screen.
 */
function healHistoryLink(): boolean {
  try {
    const restored = restorePointer(FOLDERS.HOME);
    followMove(FOLDERS.HOME);
    return restored;
  } catch (err) {
    log.error('history link not restored', err);
    return false;
  }
}

interface GatheredContext {
  dateStr: string;
  entries: ManifestEntry[];
  /** Assembled markdown parts, joined by the caller. */
  parts: string[];
}

/**
 * Gather the dynamic SessionStart context once: today's date, last-session
 * tail, today's reports, pinned reports, recent git activity across the tracked
 * repos, and a warning for each home check that fails.
 * Shared by `assembleContext` (which renders the hook payload) and
 * `contextManifest` (which exposes the structured manifest for the status
 * screen) so the two never drift.
 */
async function gatherContext(
  restoredHistory = false,
  skill: SkillCommand = DEFAULT_HOST.skill
): Promise<GatheredContext> {
  const tail = await lastSessionTail(CONTEXT.SESSION_TAIL_BYTES);
  const reports = await todaysReports(CONTEXT.REPORTS_BYTES);
  const pinned = pinnedReports(CONTEXT.MAX_PINS);
  const extensions = skillExtensions();

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: TIMEZONE
  });

  // Inside the home, the knowledge log is the home's own history, so it reads as that.
  const homeHistory = isInside(FOLDERS.KNOWLEDGE, FOLDERS.HOME);
  const repos: { label: string; lane: string; unit: string; path: string }[] = [
    {
      label: homeHistory ? 'history' : 'knowledge',
      lane: homeHistory ? 'history' : 'git: knowledge',
      unit: homeHistory ? 'snapshot' : 'commit',
      path: FOLDERS.KNOWLEDGE
    },
    ...extraGitRepos().map((path) => ({ label: basename(path), lane: `git: ${basename(path)}`, unit: 'commit', path }))
  ];
  const gitLogs = repos.map((repo) => ({
    ...repo,
    output: recentGitLog(repo.path)
  }));

  const [knowledgeGit, ...extraGit] = gitLogs.map(
    (log): ManifestEntry => ({
      label: log.lane,
      status: log.output ? 'loaded' : 'unavailable',
      bytes: log.output?.length ?? 0,
      note: log.output ? countOf(log.output.split('\n').length, log.unit) : undefined
    })
  );
  const entries: ManifestEntry[] = [
    tail.entry,
    reports.entry,
    pinned.entry,
    ...(extensions ? [extensions.entry] : []),
    ...(knowledgeGit ? [homeHistoryLane(knowledgeGit, restoredHistory, skill)] : []),
    ...extraGit
  ];

  const traveling = HOME_TIMEZONE && HOME_TIMEZONE !== TIMEZONE ? ` — ✈️ traveling (home: ${HOME_TIMEZONE})` : '';
  const today = `## Today\n${dateStr} (${TIMEZONE})${traveling}`;
  const parts: string[] = [];
  if (welcomePending()) parts.push(welcomePart());
  if (tail.content) parts.push(`## Last Session Memory (archived — not this conversation)\n\n${tail.content}`);
  if (reports.content) parts.push(`## Today's Reports\n\n${reports.content}`);
  if (pinned.content) parts.push(`## Pinned\n\n${pinned.content}`);

  const gitSections = gitLogs
    .filter((log) => log.output)
    .map((log) => `### ${log.label}\n\n\`\`\`\n${log.output}\n\`\`\``);
  if (gitSections.length > 0) parts.push(`## Recent Git Activity\n\n${gitSections.join('\n\n')}`);

  // Home-check warnings sit right after `## Today`, ahead of the long lanes, so the size cap never cuts them.
  const warnings: string[] = [];
  const warn = (label: string, note: string, section: string[]): void => {
    entries.push({ label, status: 'unavailable', bytes: 0, note });
    warnings.push(section.join('\n'));
  };
  const stranded = unresolvedPlaceholders();
  if (stranded.length > 0) {
    warn('identity files', 'unresolved placeholders', [
      '## ⚠️ Unresolved scaffold placeholders',
      '',
      'These files still contain template placeholders that `init` or `upgrade` should have',
      'substituted. They are loaded into context every session, so the agent is reading its own',
      'identity with the placeholder in place:',
      '',
      ...stranded.map((line) => `- ${line}`),
      '',
      '**Report this to the operator and let them decide. Do not edit these files yourself',
      'unless they ask you to.** The likely cause is a failed substitution during init or',
      'upgrade, in which case the fix is to replace each placeholder with its intended value —',
      `\`{{AGENT_NAME}}\` is whatever \`IDENTITY.md\` gives as **Name**. But an operator may also`,
      'have written this text deliberately (notes about a templating system, for instance), and',
      'silently rewriting their own words would be worse than the warning. Do not re-run init to',
      'repair it either: the re-run path offers to overwrite these same files.'
    ]);
  }

  const layout = HOSTS.filter((host) => host.usedBy(FOLDERS.HOME)).flatMap((host) =>
    host.homeIssues(FOLDERS.HOME, skill)
  );
  if (layout.length > 0) {
    warn('manual layout', 'needs upgrade', [
      '## ⚠️ Operating manual layout',
      '',
      ...layout.map((line) => `- ${line}`),
      '',
      '**Report this to the operator.** Do not move or delete the files yourself; the upgrade',
      'backs up, verifies, and rolls back, and a by-hand move has none of that.'
    ]);
  }

  // A due upgrade re-points the footer itself, and the banner's upgrade line already says to run it.
  const statusLine =
    getUpgradeStatus().state === 'current'
      ? statusLineDrift(resolve(FOLDERS.HOME, '.claude'), CLI_PATH, skill)
      : undefined;
  if (statusLine) {
    warn('status line', 'needs upgrade', [
      '## ⚠️ Status line',
      '',
      `- ${statusLine}`,
      '',
      '**Report this to the operator.** The upgrade re-points the entry from the plugin that is',
      'actually loaded; a by-hand edit of `settings.json` is what the sandbox exists to prevent.'
    ]);
  }

  if (TIMEZONE_ISSUE) {
    warn('time zone', 'AGENT_TIMEZONE invalid', [
      '## ⚠️ Time zone',
      '',
      `- ${TIMEZONE_ISSUE}`,
      '',
      '**Report this to the operator.** The value lives in `.claude/settings.local.json` `env`.'
    ]);
  }

  const hosts = hostIssues(checkHosts(requiredHosts(FOLDERS.HOME)));
  if (hosts.length > 0) {
    warn('host versions', 'update the host', [
      '## ⚠️ Host versions',
      '',
      ...hosts.map((line) => `- ${line}`),
      '',
      '**Report this to the operator.** The plugin carries no compatibility shims for older hosts;',
      'init and upgrade refuse to run until the host is updated.'
    ]);
  }

  // Extensions change how skills behave, so they sit ahead of the long lanes too and the size cap never cuts them.
  return { dateStr, entries, parts: [today, ...warnings, ...(extensions ? [extensions.content] : []), ...parts] };
}

/** Join the parts under the hook's size cap; a cut inside a code fence closes the fence so what follows isn't swallowed. */
export const fitContext = (parts: readonly string[], maxChars: number): string => {
  const context = parts.join('\n\n---\n\n');
  if (context.length <= maxChars) {
    return context;
  }
  const cut = context.slice(0, maxChars);
  // A fence closes only on a bare run of at least as many backticks as opened it.
  const open = cut.split('\n').reduce<string | null>((fence, line) => {
    const run = line.match(/^`{3,}/)?.[0];
    if (run === undefined) {
      return fence;
    }
    if (fence === null) {
      return run;
    }
    return run.length >= fence.length && line.trim() === run ? null : fence;
  }, null);
  return `${cut}${open === null ? '' : `\n${open}`}\n\n...(truncated)`;
};

/**
 * Scaffold placeholders left unresolved in the home's identity files.
 *
 * `init` and `upgrade` substitute `{{TOKEN}}` when they write these, and both
 * check their own work — but both are skills, so the check is an instruction a
 * model has to follow rather than something the code enforces. A miss is
 * otherwise silent: the raw token sits in the file and loads into every session
 * from then on. This is the mechanical backstop, and it costs five small reads
 * once per session.
 *
 * Matches the template convention (`{{ALL_CAPS}}`) rather than a fixed list, so
 * a token added later is caught without anyone remembering to update this.
 */
const unresolvedPlaceholders = (): string[] => {
  const files = [FILES.AGENTS, FILES.CLAUDE, FILES.SOUL, FILES.IDENTITY, FILES.USER];
  return files.flatMap((file) => {
    try {
      const found = [...readText(file).matchAll(/\{\{[A-Z][A-Z0-9_]*\}\}/g)].map((match) => match[0]);
      return found.length > 0 ? [`${basename(file)}: ${[...new Set(found)].join(', ')}`] : [];
    } catch {
      return []; // absent file — normal (the bridge before migration, USER.md pre-init)
    }
  });
};

/**
 * `promptRow: true` when a prompt row draws nudges and alerts, so the banner keeps only hints.
 */
export async function assembleContext({
  promptRow = false,
  host
}: {
  promptRow?: boolean;
  host: HostAdapter;
}): Promise<AssembledContext> {
  // Started first so its file reads overlap the git calls gathering does.
  const pendingNotices = collectNotices().catch((err: unknown) => {
    log.error('notices skipped', err);
    return [];
  });
  const gathered = await gatherContext(healHistoryLink(), host.skill);
  const launchIssue = host.launchIssue();
  const { entries } = gathered;
  // Right after `## Today`, so the size cap below never cuts it.
  const [today, ...rest] = gathered.parts;
  const parts = launchIssue ? [today, launchIssue.section, ...rest] : gathered.parts;

  const context = fitContext(parts, CONTEXT.MAX_CHARS);
  const notices = (await pendingNotices).filter((notice) => !promptRow || notice.level === 'hint');
  const weight = alwaysLoadedBytes(host);
  const banner = renderBanner(entries, context.length, weight, notices, launchIssue, host.skill);
  const hasIssues =
    launchIssue !== null || entries.some((entry) => entry.status === 'missing' || entry.status === 'unavailable');
  return { context, banner, hasIssues };
}

export interface ContextManifest {
  date: string;
  entries: ManifestEntry[];
  bytes: number;
}

/** Structured view of the dynamic SessionStart context — consumed by the
 *  `status` screen's Context Assembly tab. */
export async function contextManifest(): Promise<ContextManifest> {
  const { dateStr, entries, parts } = await gatherContext();
  const bytes = Math.min(parts.join('\n\n---\n\n').length, CONTEXT.MAX_CHARS);
  return { date: dateStr, entries, bytes };
}
