/**
 * The plugin's CLI (`bun src/cli.ts <group> …`): task + knowledge ops from outside Claude Code.
 * `HELP` below lists every subcommand.
 */
import { CLI_COMMAND, RUNTIME_DIR, pluginName } from '@/shared/naming';

// Stage the environment for the whole CLI run: hydrate every .claude/settings*.json
// `env` block on the ancestor path (nearest wins) so per-project paths
// (AGENT_HOME, AGENT_KNOWLEDGE, ...) apply without shell-rc duplication, then
// anchor AGENT_HOME through the shared resolver. Order matches Claude Code:
// settings.local.json (machine-specific) overrides settings.json (committed);
// existing shell env always wins. Every server import below is dynamic, which
// keeps each CLI invocation to the one subsystem it needs instead of loading
// all of them. A `--home=PATH` argument anywhere on the line pins
// AGENT_HOME first: the Codex hooks pass the home that way because their command
// line has to parse under sh and PowerShell alike, and an env prefix does not.
async function loadProjectEnv(): Promise<void> {
  // Pin the home before the server's bootstrap walks the settings, so it walks from that home; importing
  // shared/env first would resolve the home and load secrets before a settings block could name it.
  const { pinHome } = await import('@/shared/settings-env');
  const home = process.argv.find((arg) => arg.startsWith('--home='))?.slice('--home='.length);
  if (home) pinHome(home);
  await import('@/bootstrap');
  const { agentHomePath } = await import('@/shared/env');
  agentHomePath();
}
// The status line re-runs on every render tick and takes its folder from the payload, so it
// skips the settings walk and the home gate every other verb needs.
if (process.argv[2] === 'statusline') {
  const { runStatusLine } = await import('@/statusline/run');
  await runStatusLine(process.argv.slice(3), import.meta.path);
  process.exit(0);
}

await loadProjectEnv();

const [, , group, command, ...args] = process.argv;
// Flags may follow the group directly (`session-start --hook-protocol=claude`), so they're read from the command slot too.
const verbArgs = [command, ...args].filter((arg): arg is string => Boolean(arg));

function flag(name: string): string | undefined {
  const f = verbArgs.find((a) => a.startsWith(`--${name}=`));
  return f?.slice(name.length + 3);
}

function flagArr(name: string): string[] {
  const value = flag(name);
  return value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

function flagAll(name: string): string[] {
  return verbArgs
    .filter((a) => a.startsWith(`--${name}=`))
    .map((a) => a.slice(name.length + 3))
    .filter(Boolean);
}

function bool(name: string): boolean {
  return verbArgs.includes(`--${name}`);
}

const PLUGIN = pluginName();

/** capture's own flags, plus the global --home: anything else is the note. */
const CAPTURE_FLAGS = ['text', 'file', 'url', 'kind', 'title', 'label', 'home'] as const;

const HELP = `\
${PLUGIN} CLI

Usage:
  ${CLI_COMMAND} <group> <command> [flags]

Groups:
  ping                              Print resolved paths + timezone (sanity check)
  colors [--line=<1-4 | "#RRGGBB #RRGGBB">]
                                    Show the color pairs an agent can take, each in its own colors; --line prints a choice's
                                    IDENTITY.md Colors value (exit 2 when it isn't a pair number or two codes). Read-only
  hosts                             Check the installed Claude Code / Codex CLIs against the plugin's version floors (--codex: require Codex); exit 1 below a floor
  capture                           Capture text / a file / stdin into raw/inbox/ (or feedback.md) for the next compile
  session-capture                   Ingest a session transcript into raw/sessions/<today>.md (called by Claude Code hooks)
  session-start                     Emit dynamic context (today / last session tail / git activity) for the host's SessionStart hook
  statusline                        Render Claude Code's footer from the status-line JSON on stdin (--setting: the settings entry)
  task                              Read + mutate task files under projects/*/tasks/
  compile                           Knowledge-compile state (synthesis runs in Claude Code, not here)
  knowledge                         Wiki maintenance (lint)
  notices                           What to nudge the operator about (upgrade, sync) as JSON; \`notices record <id> --outcome=acted|snoozed\` logs what they did
  heartbeat                         The session that keeps the home's work coming: status, bind, release, off
  messages                          What the agent surfaced on its own, proposals and notes alike: decide
  notes                             What the agent found and sent on its own, at most three a day: list
  proposals                         Sessions the agent proposes: list
  prune                             Delete memory/YYYY-MM-DD*.md older than 14 days
  links                             Rewrite bare task IDs + shorthand into [[wikilinks]]
  dashboard                         Rebuild the Agent OS dashboard at <HOME>/dashboard.html + projects/TASKS.md (open in any browser)
  worktree                          Create a sibling git worktree of <repoPath> and bootstrap it (copy locals → install → build); \`worktree remove\` tears one down safely
  seed                              One-shot agent handoff: scan what this home could seed a teammate with, export a reviewed selection as a zip bundle, import a bundle into a fresh home
  database                          Query/inspect/fork local Postgres via AGENT_DB_<NAME> connections (real terminal — outside the Bash sandbox)
  cmux                              The optional cmux pack: the AgentLayer sidebar, one per Mac, that every home on it joins

Task commands:
  task query [--status=X] [--priority=P0-P3] [--project=NAME]
  task get <id>
  task create --project=NAME --title=... --description=... [--priority=P2] [--type=task|bug|idea|epic] [--due=YYYY-MM-DD] [--horizon=today|week|next-week|month|later] [--labels=a,b] [--depends_on=id1,id2] [--parent=ID] [--checklist=item ...]
  task update <id> [--status=X] [--priority=X] [--title=X] [--due=YYYY-MM-DD] [--horizon=X] [--blocked_by=X] [--labels=a,b] [--depends_on=id1,id2] [--parent=ID] [--issue=URL] [--description=...]
  task close <id>
  task thread <id> --message=... [--type=quote|info|warning]
  task scan                         Resolve dependencies, surface overdue/stale/auto-* changes

Capture commands:
  capture "the thought"             Write inline text to raw/inbox/<ts>-<slug>.md (next compile distils it)
  capture --file=PATH               Capture a file's contents into raw/inbox/
  capture --url=URL                 Fetch a URL, strip HTML noise (<script>/<style>/<head>), store with source: url:<url> in frontmatter
  capture --stdin                   Read content from stdin (e.g. \`pbpaste | ${CLI_COMMAND} capture --stdin\`)
  capture ... --kind=feedback       Append to raw/user/feedback.md instead of inbox/ (corrections/preferences)
  capture ... --title=X --label=Y   Optional metadata (slug source + frontmatter label)

Hook commands (internal — wired into Claude Code hooks; safe to run manually for testing):
  session-capture --mode=session-end|pre-compact|turn-end --hook-protocol=claude
                                    Read hook JSON from stdin and append the transcript to raw/sessions/.
  session-capture --mode=... --transcript=PATH --cwd=PATH --session-id=X
                                    Plain-CLI mode — same logic without the hook envelope. Useful for testing.
  session-capture ... --format=claude (default)
                                    Transcript-format adapter (claude, codex, antigravity).
  session-start [--hook-protocol=claude|codex|antigravity]
                                    Emit dynamic SessionStart context. Without the flag, prints the structured result for testing.
  session-start|session-capture ... --home=PATH
                                    Pin the agent home from the command line (how the per-home Codex and Antigravity hooks name it)
  guard [--hook-protocol=claude|codex|antigravity]
                                    PreToolUse hook: read the tool call from stdin and exit 2 when a shell command
                                    would write a home tree (knowledge/, projects/, reports/) relative to a cwd outside the home,
                                    move the session anywhere but back to the home (claude only: a cd carries over there), find
                                    scratch in the shared temp dir by pattern or a hand-picked $TMPDIR name, rewrite git history
                                    (commit --amend, an ours merge, stash --keep-index), or commit, merge or push after a gate
                                    joined by anything but &&

Knowledge commands:
  knowledge lint [--fix]            Structural health check; --fix rewrites stale wikilinks + inserts backlinks

Seed commands (prefer the /${PLUGIN}:seed export skill inside Claude Code — it runs the interview + review gate):
  seed scan                         Detect what this home could seed a teammate with (read-only JSON)
  seed export --include=p1,p2 --name=AGENT [--out=PATH]
                                    Build a seed bundle zip from home-relative paths (no review gate here — you are the gate)
  seed import <bundlePath> [--overwrite] [--dry-run]
                                    Overlay a bundle onto THIS home; --dry-run prints the plan + conflicts first

Slack commands (read-only; per-operator OAuth):
  slack auth                        One-time OAuth (PKCE) — opens browser, mints + persists user token
  slack whoami                      Show authenticated Slack identity
  slack list-channels               List channels you're a member of (name, id, topic)
  slack history <channel> [--since=24h] [--limit=100]
  slack batch-history <ch1,ch2,...> [--since=24h] [--limit=100]    Multi-channel history in one process
  slack thread <channel> <thread_ts>
  slack search <query> [--in=<channel>] [--since=7d]

  Categorisation lives in <HOME>/knowledge/concepts/slack-channels.md — read by the
  /${PLUGIN}:slack skill for multi-channel composition.

Compile commands:
  compile status                    Show queue (pending sessions, feedback, inbox)
  compile next                      Print next work item (no synthesis — run /${PLUGIN}:knowledge-compile for that)
  compile write <itemId>            Mark item complete (advanced — synthesis writes use this internally)

Worktree commands:
  worktree <repoPath> --branch=BRANCH [--base=REF] [--slug=SLUG] [--extra=sub1,sub2]
                                    Create <repoPath>-<slug> as a sibling of the main checkout, copy gitignored locals,
                                    install, build. A bare --branch is namespaced under the operator (<operator>/<name>).
                                    --base picks the start-point (default: dev → develop → main → master → current HEAD).
                                    --extra lists relative subdirs with their own lockfile.
                                    NOTE: blocked by the Bash sandbox when run from inside Claude Code (git can't write
                                    .git/config) — use the setup_worktree MCP tool there; this CLI is for a real terminal.
  worktree list <repoPath>          Audit every registered worktree: branch, dirty/unpushed counts, ahead/behind and
                                    merge state vs the base ref, last-commit age, and a verdict (deletable / uncommitted /
                                    unpushed / pushed-unmerged / missing / base / main). Read-only — fine anywhere.
  worktree remove <worktreePath> [--delete-branch] [--force] [--dry-run]
                                    Safely remove a worktree: refuses on a dev/develop/main/master worktree and on
                                    uncommitted changes; needs --force when the branch has commits on no remote
                                    and no local base branch; runs the repo's \`clean\` script first.
                                    Keeps the branch unless --delete-branch. --dry-run reports the status without
                                    touching anything. Same sandbox note — use remove_worktree there.

Sidebar commands for cmux (this CLI's, not the cmux app's own; run them from a terminal inside cmux):
  cmux sidebar install              Add this home to the AgentLayer sidebar (starting it if it's the first), have cmux check it, and show it
  cmux sidebar refresh              Put this home's latest projects and tasks into the sidebar (every dashboard refresh also does this)
  cmux sidebar remove               Take this home out of the sidebar; the last home out deletes it
  cmux settings --file=<ghostty|cmux> [--launcher=<claude|agent>] [--json]
                                    Compare a Mac's Ghostty or cmux settings with the recommended ones (read-only;
                                    prints what to paste and the command to run; without --json, exit 3 unless the file is complete)

Notes commands:
  notes list [--json]               Today's notes, the room left, and the notes of the last two weeks
  notes brief [--json] [--workspaces=<json list>]
                                    Hand out the next scouting run's lens (recorded as run), the agent it runs in, and that agent's whole task; names each line of knowledge/public.md it leaves out
  notes public                      What the code keeps of knowledge/public.md, and each line it leaves out; hands out no run
  messages decide <start|later|dismiss> <id> [--workspace=<id>]
                                    Open a session on a proposal or a note (in that cmux workspace when named), put it off until morning, or drop it

Proposals commands:
  proposals list [--json]           What's showing and the room for more

Heartbeat commands:
  heartbeat status [--json]         Who the heartbeat is, its interval, the brain's last refresh, and the room for proposals and notes
  heartbeat bind --owner=<token> [--every=<duration>]
                                    Make the session holding that token the heartbeat (/heartbeat passes its own), looking every 55m unless set (15m, 2h)
  heartbeat release --owner=<token> End that session's heartbeat, if that token still holds it
  heartbeat off                     No heartbeat

Database commands:
  database list                     List configured AGENT_DB_<NAME> connections (name + host/db, never credentials)
  database schema --connection=NAME [--table=T] [--schema=S] [--database=DB]
                                    List user tables, or describe one table's columns (read-only)
  database query --connection=NAME --sql="SELECT ..." [--database=DB] [--timeout=MS]
                                    Run read-only SQL (server-enforced READ ONLY tx; writes/DDL rejected)
  database fork [--connection=NAME] [--source=DB] [--fork=NAME] [--cwd=PATH] [--repoint-env] [--env-var=DATABASE_URL] [--force] [--terminate-source] [--drop]
                                    Clone a LOCAL database via CREATE DATABASE ... TEMPLATE. Fork name defaults to
                                    <source>_<git-branch> when --cwd is a repo, else <source>_fork. --repoint-env writes a
                                    .env.local override in --cwd; --drop tears the fork down. Remote hosts refused.

Environment:
  AGENT_HOME=<path>                 Override agent home (default: cwd)
  AGENT_PROJECTS=<path>             Override projects/ location (default: <HOME>/projects)
  AGENT_KNOWLEDGE=<path>            Override knowledge/ location (default: <HOME>/knowledge)
  AGENT_TIMEZONE=<tz>               Override timezone (default: system tz)

Examples:
  ${CLI_COMMAND} capture "remember to follow up with the accountant on the annual filing"
  ${CLI_COMMAND} capture --file=~/notes/board-meeting.md --title="Board meeting 2026-05-28"
  ${CLI_COMMAND} capture --url=https://docs.anthropic.com/en/docs/claude-code/overview
  pbpaste | ${CLI_COMMAND} capture --stdin --title="Clipped article"
  ${CLI_COMMAND} capture --kind=feedback "don't propose git push for local-only repos"
  ${CLI_COMMAND} task query --status=active
  ${CLI_COMMAND} task create --project=blog-dev --title="Draft launch post" --description="..." --priority=P1
  ${CLI_COMMAND} dashboard
  ${CLI_COMMAND} worktree /path/to/repo --branch=feat/my-thing
  ${CLI_COMMAND} knowledge lint --fix
  ${CLI_COMMAND} compile status
  ${CLI_COMMAND} database list
  ${CLI_COMMAND} database query --connection=app --sql="select count(*) from users"
  ${CLI_COMMAND} database fork --connection=app --cwd=/path/to/worktree --repoint-env
`;

async function run(): Promise<void> {
  if (!group || group === 'help' || group === '--help' || group === '-h') {
    console.log(HELP);
    process.exit(group ? 0 : 1);
  }

  // Read-only, and runs before a home exists: the setup guide checks a Mac's terminal settings with it. It comes
  // before the invocation log below, which writes into the home it runs in.
  if (group === 'cmux' && command === 'settings') {
    const { runSettingsCommand } = await import('@/cmux/settings');
    process.exit(runSettingsCommand(flag('file'), bool('json'), flag('launcher')));
  }

  // Read-only: init shows the choices with it while it names a new agent, then writes the line --line prints.
  if (group === 'colors') {
    const [{ colorChoices, colorsLineFor }, { agentColors }, { env }, { stripAnsi }] = await Promise.all([
      import('@/home/colors'),
      import('@/shared/agent-name'),
      import('@/shared/env'),
      import('@/shared/ansi')
    ]);
    const choice = flag('line');
    if (choice !== undefined) {
      const line = colorsLineFor(choice);
      if (!line) {
        console.error('Usage: colors --line=<1-4 | "#RRGGBB #RRGGBB">');
        process.exit(2);
      }
      console.log(line);
      return;
    }
    const rows = colorChoices(agentColors()).join('\n');
    console.log(env('NO_COLOR') ? stripAnsi(rows) : rows);
    return;
  }

  // One info line per CLI invocation so file logs reveal user-invoked vs
  // MCP-invoked traffic. Lazy-imported because @/shared/log resolves AGENT_HOME
  // and we want loadProjectEnv() to have run first.
  const { log } = await import('@/shared/log');
  if (group !== 'guard') {
    // guard runs before every shell command; logging each run would drown the file.
    log.with('cli').info(`${group}${command ? ` ${command}` : ''}${args.length ? ` ${args.join(' ')}` : ''}`);
  }

  const { FOLDERS, TIMEZONE, isInitialized } = await import('@/config');

  if (group === 'ping') {
    console.log(
      JSON.stringify(
        {
          // Whether the resolved path is this agent's home, which is what decides
          // if any other command will run — not merely whether a brain exists there.
          ok: isInitialized(),
          timezone: TIMEZONE,
          home: FOLDERS.HOME,
          data: FOLDERS.DATA,
          knowledge: FOLDERS.KNOWLEDGE,
          projects: FOLDERS.PROJECTS
        },
        null,
        2
      )
    );
    return;
  }

  // Runs before a home exists: init gates on it before scaffolding anything.
  if (group === 'hosts') {
    const { checkHosts, requiredHosts } = await import('@/upgrade/hosts');
    const report = checkHosts(requiredHosts(FOLDERS.HOME, bool('codex') ? ['codex'] : []));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  // Refuse to touch anything that isn't THIS agent's home. Resolution falls back
  // to cwd when nothing above it qualifies (see agentHomePath), so a CLI run from
  // a code repo would otherwise read an empty tree and WRITE a knowledge/ +
  // projects/ scaffold into it, reporting success. Hooks and stdio MCP servers
  // were never exposed — the host exports CLAUDE_PROJECT_DIR and it doesn't roam
  // with the shell — but a plain terminal has no such anchor.
  //
  // Gate on the home marker (a state file inside the data dir), the same
  // marker `agentHomePath` walks for, NOT on SOUL.md: every sibling agent's
  // home has a SOUL.md, so a SOUL.md test passes inside another agent's brain
  // and hands it this agent's writes. Only this agent's home carries this
  // agent's marker files.
  //
  // The session verbs are exempt: they self-guard and return the structured
  // "not-initialized" result the host's hook protocol expects, and failing hard
  // there would surface as a hook error on every session started outside a home.
  // `worktree` is exempt because it acts on the repo path it's given, not on
  // home state.
  const HOMELESS_OK = new Set(['session-start', 'session-capture', 'guard', 'worktree']);
  if (!isInitialized() && !HOMELESS_OK.has(group)) {
    console.error(
      `${group}: ${FOLDERS.HOME} is not this agent's home (no ${RUNTIME_DIR}/version.json recording ${PLUGIN} there).\n` +
        `The home is resolved from the current directory, so this is what you get when\n` +
        `the CLI runs outside one. Run it from inside the home, or point it at one:\n` +
        `  AGENT_HOME=/path/to/home ${CLI_COMMAND} ${group}${command ? ` ${command}` : ''}`
    );
    process.exit(1);
  }

  if (group === 'task') {
    switch (command) {
      case 'query': {
        const { queryTasks } = await import('@/tasks/scan');
        const filters: Record<string, string> = {};
        for (const k of ['status', 'priority', 'project']) {
          const v = flag(k);
          if (v) filters[k] = v;
        }
        const result = queryTasks(filters);
        console.log(
          JSON.stringify(
            result.map((t: { frontmatter: object; filePath: string }) => ({ ...t.frontmatter, filePath: t.filePath })),
            null,
            2
          )
        );
        return;
      }
      case 'get': {
        const id = args[0];
        if (!id) throw new Error(`Usage: ${CLI_COMMAND} task get <id>`);
        const { findTaskById } = await import('@/tasks/scan');
        const task = findTaskById(id);
        if (!task) {
          console.error(`Task not found: ${id}`);
          process.exit(1);
        }
        console.log(JSON.stringify(task, null, 2));
        return;
      }
      case 'create': {
        const project = flag('project');
        const title = flag('title');
        const description = flag('description');
        if (!project || !title || !description) {
          throw new Error('Required: --project --title --description');
        }
        const { createTask } = await import('@/tasks/mutate');
        const res = createTask({
          project,
          title,
          description,
          assignee: [],
          priority: (flag('priority') as 'P0' | 'P1' | 'P2' | 'P3') ?? 'P2',
          type: (flag('type') as 'task' | 'bug' | 'idea' | 'epic') ?? 'task',
          labels: flagArr('labels'),
          due: flag('due') ?? '',
          horizon: flag('horizon') ?? '',
          depends_on: flagArr('depends_on'),
          parent: flag('parent') ?? '',
          checklist: flagAll('checklist')
        });
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      case 'update': {
        const id = args[0];
        if (!id) throw new Error(`Usage: ${CLI_COMMAND} task update <id> --field=value ...`);
        const fields: Record<string, string | string[]> = {};
        for (const k of ['status', 'priority', 'title', 'due', 'horizon', 'blocked_by', 'parent', 'issue', 'description']) {
          const v = flag(k);
          if (v) fields[k] = v;
        }
        if (flagArr('labels').length) fields.labels = flagArr('labels');
        if (flagArr('depends_on').length) fields.depends_on = flagArr('depends_on');
        const { updateTask } = await import('@/tasks/mutate');
        updateTask(id, fields);
        console.log(JSON.stringify({ ok: true, written: Object.keys(fields) }));
        return;
      }
      case 'close': {
        const id = args[0];
        if (!id) throw new Error(`Usage: ${CLI_COMMAND} task close <id>`);
        const { closeTask } = await import('@/tasks/mutate');
        closeTask(id);
        console.log(JSON.stringify({ ok: true }));
        return;
      }
      case 'thread': {
        const id = args[0];
        const message = flag('message');
        if (!id || !message) throw new Error(`Usage: ${CLI_COMMAND} task thread <id> --message=...`);
        const { appendThread } = await import('@/tasks/mutate');
        appendThread(id, 'me', message, (flag('type') as 'quote' | 'info' | 'warning') ?? 'info');
        console.log(JSON.stringify({ ok: true }));
        return;
      }
      case 'scan': {
        const { scanAllTasks, scanArchivedTasks } = await import('@/tasks/scan');
        const { resolveTasks } = await import('@/tasks/resolve');
        const all = scanAllTasks();
        const result = resolveTasks(all, scanArchivedTasks());
        console.log(JSON.stringify({ scanned: all.length, ...result }, null, 2));
        return;
      }
      default:
        throw new Error(`Unknown task subcommand: ${command}`);
    }
  }

  if (group === 'compile') {
    const compile = await import('@/knowledge/compile');
    switch (command) {
      case 'status':
        console.log(JSON.stringify(await compile.getStatus(), null, 2));
        return;
      case 'next':
        console.log(JSON.stringify(await compile.pickNext(), null, 2));
        return;
      case 'write': {
        const itemId = args[0];
        if (!itemId) throw new Error(`Usage: ${CLI_COMMAND} compile write <itemId>`);
        console.log(JSON.stringify(await compile.markComplete(itemId), null, 2));
        return;
      }
      default:
        throw new Error(`Unknown compile subcommand: ${command}`);
    }
  }

  if (group === 'knowledge') {
    switch (command) {
      case 'lint': {
        const { run } = await import('@/knowledge/lint');
        const summary = await run({ fixMode: args.includes('--fix') });
        console.log(JSON.stringify(summary, null, 2));
        if (summary.status === 'error') process.exit(1);
        return;
      }
      default:
        throw new Error(`Unknown knowledge subcommand: ${command}`);
    }
  }

  if (group === 'seed') {
    switch (command) {
      case 'scan': {
        const { scanSeed } = await import('@/seed/scan');
        console.log(JSON.stringify(scanSeed(), null, 2));
        return;
      }
      case 'export': {
        const include = flagArr('include');
        const name = flag('name');
        if (!include.length || !name) {
          throw new Error(`Usage: ${CLI_COMMAND} seed export --include=path1,path2 --name=AGENT [--out=PATH]`);
        }
        const { exportSeed } = await import('@/seed/export');
        console.log(JSON.stringify(exportSeed({ include, agentName: name, out: flag('out') }), null, 2));
        return;
      }
      case 'import': {
        const bundlePath = args.find((a) => !a.startsWith('--'));
        if (!bundlePath) throw new Error(`Usage: ${CLI_COMMAND} seed import <bundlePath> [--overwrite] [--dry-run]`);
        const { importSeed } = await import('@/seed/import');
        console.log(
          JSON.stringify(importSeed({ bundlePath, overwrite: bool('overwrite'), dryRun: bool('dry-run') }), null, 2)
        );
        return;
      }
      default:
        throw new Error(`Unknown seed subcommand: ${command}`);
    }
  }

  if (group === 'database') {
    // The database tools live as MCP tool handlers; reuse them directly rather
    // than duplicating the SQL. They read connections via shared/env's `env()`, which
    // self-loads the data-dir secrets/.env on first read — no manual preload needed.
    // Like worktree/database_fork, these run outside the Bash sandbox — this CLI
    // path is the real-terminal entry point.
    const { tools } = await import('@/database/tool');
    const byName = new Map(tools.map((tool) => [tool.name, tool] as const));
    const call = async (name: string, params: Record<string, unknown>): Promise<void> => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Tool not found: ${name}`);
      console.log(JSON.stringify(await tool.handler(params), null, 2));
    };

    switch (command) {
      case 'list':
        await call('database_list', {});
        return;
      case 'schema':
        await call('database_schema', {
          connection: flag('connection'),
          table: flag('table'),
          schema: flag('schema'),
          database: flag('database')
        });
        return;
      case 'query': {
        const connection = flag('connection');
        const sql = flag('sql');
        if (!connection || !sql) {
          throw new Error(`Usage: ${CLI_COMMAND} database query --connection=NAME --sql="SELECT ..." [--database=X] [--timeout=MS]`);
        }
        const timeout = flag('timeout');
        await call('database_query', {
          connection,
          sql,
          database: flag('database'),
          timeout_ms: timeout ? Number(timeout) : undefined
        });
        return;
      }
      case 'fork':
        await call('database_fork', {
          connection: flag('connection'),
          source: flag('source'),
          fork: flag('fork'),
          cwd: flag('cwd'),
          repointEnv: bool('repoint-env'),
          envVar: flag('env-var'),
          force: bool('force'),
          terminateSource: bool('terminate-source'),
          drop: bool('drop')
        });
        return;
      default:
        throw new Error(`Unknown database subcommand: ${command}`);
    }
  }

  if (group === 'guard' || group === 'session-start' || group === 'session-capture') {
    const { runGuard, runSessionCapture, runSessionStart } = await import('@/hooks/handlers');
    const handler = { guard: runGuard, 'session-start': runSessionStart, 'session-capture': runSessionCapture }[group];
    const code = await handler(flag);
    if (code) {
      process.exit(code);
    }
    return;
  }

  if (group === 'capture') {
    // Flags can land anywhere after `capture`. The first argument that isn't one of capture's own flags is
    // the note, so `capture "the thought"` works without --text=, even when the note starts with `--`.
    const positional = verbArgs.find((a) => a !== '--stdin' && !CAPTURE_FLAGS.some((name) => a.startsWith(`--${name}=`)));
    const wantStdin = bool('stdin');
    let text = positional ?? flag('text');
    if (!text && !flag('file') && !flag('url') && (wantStdin || !process.stdin.isTTY)) {
      text = await Bun.stdin.text();
    }
    const { capture } = await import('@/knowledge/capture');
    const result = await capture({
      text,
      file: flag('file'),
      url: flag('url'),
      kind: flag('kind') as 'inbox' | 'feedback' | undefined,
      title: flag('title'),
      label: flag('label')
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (group === 'notices') {
    const { OUTCOMES, recordOutcome, stampRow } = await import('@/notices/ledger');
    if (command === 'record') {
      const id = args.find((arg) => !arg.startsWith('--'));
      const requested = flag('outcome');
      const outcome = OUTCOMES.find((known) => known === requested);
      if (!id || !/^[a-z][a-z0-9-]*$/.test(id) || !outcome) {
        console.error(`Usage: ${CLI_COMMAND} notices record <id> --outcome=${OUTCOMES.join('|')}`);
        process.exit(1);
      }
      recordOutcome(id, outcome);
    } else if (command === '--row') {
      stampRow();
    }
    // `record` prints the list too, so a snooze redraws from the one call.
    const { collectNotices } = await import('@/notices/notices');
    console.log(JSON.stringify(await collectNotices()));
    return;
  }

  if (group === 'messages') {
    const { runMessagesCommand } = await import('@/messages/command');
    process.exit(runMessagesCommand(command, args));
  }

  if (group === 'notes') {
    const { runNotesCommand } = await import('@/notes/command');
    process.exit(runNotesCommand(command, args));
  }

  if (group === 'heartbeat') {
    const { runHeartbeatCommand } = await import('@/heartbeat/command');
    process.exit(runHeartbeatCommand(command, args));
  }

  if (group === 'proposals') {
    const { runProposalsCommand } = await import('@/proposals/command');
    process.exit(runProposalsCommand(command, args));
  }

  if (group === 'prune') {
    const { pruneMemory } = await import('@/knowledge/prune');
    await pruneMemory();
    console.log(JSON.stringify({ ok: true }));
    return;
  }

  if (group === 'links') {
    const { rewriteAllWikilinks } = await import('@/knowledge/links');
    const modified = await rewriteAllWikilinks();
    console.log(JSON.stringify({ modified, count: modified.length }, null, 2));
    return;
  }

  if (group === 'slack') {
    const { runSlackCommand } = await import('@/slack/cli');
    await runSlackCommand(command, args);
    return;
  }

  if (group === 'dashboard') {
    // Regenerate TASKS.md + <HOME>/dashboard.html and print where the snapshot landed.
    const { rebuildDashboards } = await import('@/status/html');
    console.log(JSON.stringify(await rebuildDashboards(), null, 2));
    return;
  }

  if (group === 'cmux') {
    const { runCmuxCommand } = await import('@/cmux/command');
    process.exit(await runCmuxCommand(command, args));
  }

  if (group === 'worktree') {
    // <repoPath> is positional (argv[3] = command); flags land in args.
    // NOTE: from inside Claude Code's Bash tool this is sandboxed — git can't write
    // .git/config, so it EPERMs. Use the setup_worktree/remove_worktree MCP tools there.
    // This CLI path is for a real terminal / automation where the process runs unsandboxed.

    // `worktree list <repoPath>` — read-only audit of every registered worktree.
    if (command === 'list') {
      const repoPath = args.find((a) => !a.startsWith('--'));
      if (!repoPath) {
        throw new Error(`Usage: ${CLI_COMMAND} worktree list <repoPath>`);
      }
      const { listWorktrees } = await import('@/worktree/setup');
      console.log(JSON.stringify(listWorktrees({ repoPath }), null, 2));
      return;
    }

    // `worktree remove <worktreePath> [--delete-branch] [--force] [--dry-run]` — safe teardown.
    if (command === 'remove') {
      const worktreePath = args.find((a) => !a.startsWith('--'));
      if (!worktreePath) {
        throw new Error(`Usage: ${CLI_COMMAND} worktree remove <worktreePath> [--delete-branch] [--force] [--dry-run]`);
      }
      const { removeWorktree } = await import('@/worktree/setup');
      console.log(
        JSON.stringify(
          removeWorktree({
            worktreePath,
            deleteBranch: bool('delete-branch'),
            force: bool('force'),
            dryRun: bool('dry-run')
          }),
          null,
          2
        )
      );
      return;
    }

    const repoPath = command;
    const branch = flag('branch');
    if (!repoPath || !branch) {
      throw new Error(`Usage: ${CLI_COMMAND} worktree <repoPath> --branch=BRANCH [--base=REF] [--slug=SLUG] [--extra=sub1,sub2]`);
    }
    const { setupWorktree } = await import('@/worktree/setup');
    console.log(
      JSON.stringify(
        setupWorktree({ repoPath, branch, baseBranch: flag('base'), slug: flag('slug'), extraInstalls: flagArr('extra') }),
        null,
        2
      )
    );
    return;
  }

  throw new Error(`Unknown group: ${group}`);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
