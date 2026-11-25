# Changelog

All notable changes to **agentlayer** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

This plugin was `agent-kevin` before 1.0, and its last release is 0.9.5. Those releases are in the
[agent-kevin CHANGELOG at v0.9.5](https://github.com/AgentLayer1/agent-kevin/blob/v0.9.5/CHANGELOG.md);
a home moves from it with that plugin's `/agent-kevin:move`, not with an upgrade.

The version that matters is the one in `.claude-plugin/plugin.json`. `/plugin update`
pulls new plugin **code**; it does not touch a consumer's HOME files (`AGENTS.md`,
`SOUL.md`, settings, rules, …) or run `bun install`. The **Upgrade** block in each
release below is the machine-actionable contract that `/agentlayer:upgrade` reads
to reconcile a HOME after a code update. Producers write these with
`/agentlayer:release`.

## Upgrade-block format

Each release carries an `### Upgrade` section. Every actionable line is a single
backticked tag plus a human note:

```
- `<kind>: <severity>` — <note>
```

- **kind** — `deps` · `settings` · `template/<file>` · `file` · `script` · `skill` · `manual`
- **severity** — `required` (deps/script) · `mandatory` (auto-applied) · `optional`
  (the upgrade asks first, with a diff) · `additive` (copy if absent) · `none`

A `script: <severity>` line means the release ships a one-time migration at
`skills/upgrade/scripts/<version>.ts` (named for this release). `/agentlayer:upgrade`
runs it via the `run_upgrade` MCP tool — outside the Bash sandbox, so it can
touch deny-gated paths. The script is self-contained, idempotent, and prints a JSON
report; it carries no permanent footprint in the server and may be pruned once the
minimum supported baseline passes it (a `script:` whose file is absent is treated as
already-applied). Use it for heavy data moves; use `manual` for steps a human must do
by hand.

A `skill: required` line names a plugin skill the upgrade runs once the home is migrated and
before its closing sync, for work that needs the operator in the room, such as a self-review
that clears what the release stops writing. When the upgrade must end with a restart, it names
the skill to run right after the restart, before the sync.

A code-only release writes a single line: `None — code-only, no bun install or HOME changes.`

`/agentlayer:upgrade` collects every Upgrade block from a HOME's recorded baseline
(`<HOME>/.state/version.json`) up to the installed version, coalesces them, backs up
touched files to `.state/updates/`, auto-applies the mandatory/additive/deps actions,
and prompts per optional one. The new template files are the source of truth for
*content*; these tags only say *which* files changed and *how aggressively* to apply.

<!-- Add new releases below this line, newest first. -->

## [1.2.0] - 2026-11-25

Antigravity is the third host, tax becomes part of a finances skill, and the packs are one numbered
table that starts from what the home already has.

### Added
- Antigravity (`agy`) is a third host. It loads the plugin in place from the checkout as a plugin of
  its own: the skills, an always-on rule with their glossary, the hooks and the MCP server, which
  learns its home from the session's folder (`--home-from-roots`). A `policy` hook applies the home's
  Claude rules to every Antigravity tool, asks through Antigravity's own prompt where Claude Code
  would ask, and has file tools ask before leaving the home's folders. Antigravity has no session-end
  event, so each conversation is recorded as it runs and saved at the next session start. Init and
  upgrade write a paste-ready note for the two user-level files Antigravity reads; neither is edited
  for you. Windows is offered and labelled unverified.
- `hosts status` in the CLI shows every host the plugin runs in, what each can do, and what's left
  to finish its wiring.
- The `finances` skill: bank, card and platform statements imported and proven against their own
  balances (a statement that doesn't add up is refused), receipts filed and matched to the line they
  paid for, and a finances page built from the imported lines: where the money goes by week, month
  or year, cash flow, bills, the director balance, charity and checks, with a Hide amounts switch.
  Categories learn: rules live in the finances project's `RULES.md`, the agent suggests and the
  operator approves, and edits made on the page paste back into a session. Sync nudges an import when
  the inbox has files, files what the page raises as tasks, and keeps the page current. `capture`
  takes `kind: finance` with a file and copies it byte for byte into the inbox.
- Currencies: each entity profile pins the currency it pays tax or is registered in, and each account
  keeps its own, so statements import in any currency. The page's summaries (overview, cash flow,
  where it goes, bills, the director balance, charity) switch between the entity's currency and USD
  at each month's central-bank rate, fetched from Frankfurter with no key (only currency codes and
  dates leave the machine) into `data/rates.csv`; transaction lines stay as the bank wrote them. Tax
  rules ship for Malaysia so far, and entities elsewhere get statements and the page without a tax
  view.
- `packs_status`: every optional pack, its group and blurb, and whether this home has it (`new`,
  `partial` with what's missing, or `ready`). It reads settings, `.mcp.json`, home files and the
  secret store's key names, never a value. One registry in the code now holds all fourteen packs.

### Changed
- The `tax` skill folds into `finances` as its tax playbook, with a new playbook for reviewing an
  accountant's management accounts and general ledger. The tax engine counts only tasks labelled
  `tax`, so other finances tasks stay off the tax calendar.
- configure-skills opens with what the home has: install something new, finish or change what's set
  up, or remove a pack, each from one numbered table per group (reply with numbers, a group, or
  `recommended`). A half-done pack resumes at what's missing. Finances is a pack. Init's pack step
  is the same table.
- Codex: the home's own Codex sessions send no usage analytics and no `/feedback` uploads, and init
  asks about Codex only when Codex is installed.
- The cmux sidebar reads in light mode as well as dark, with one palette for both, and the Needs you
  and Inbox cards are tinted (cmux-custom-manager `b135877`).

### Upgrade
- `script: required` — run skills/upgrade/scripts/1.2.0.ts: moves `projects/tax/` into
  `projects/finances/`. Profiles, closes, estimates and reviews keep their place; the ledger,
  receipts and inbox go under `projects/finances/data/`, which the home's `.gitignore` keeps out of
  history (reconciled with the template first). Tax tasks are renumbered into the finances prefix,
  gain the `tax` label, and every task file that names an old id is rewritten; the old-to-new id map
  is appended to the finances README. A file whose destination already holds something different
  stays where it is and is reported. A home without `projects/tax/` is untouched.
- `settings: mandatory` — add `mcp__plugin_agentlayer_agent__packs_status` to `permissions.allow`.
  `Skill(agentlayer:tax)` becomes `Skill(agentlayer:finances)` where it sits.
- `deps: required` — `cmux-custom-manager` moves to `b135877`; run `bun install` in the plugin root.
- `settings: optional` — add `api.frankfurter.dev` to `sandbox.network.allowedDomains`, so the
  finances page can fetch exchange rates for its USD view.
- `manual: optional` — finances only: add `currency:` (such as `MYR`) to each profile in
  `projects/finances/entities/`. An import into an entity without one is refused until it's added,
  so a currency guessed from the country is never saved.
- `manual: optional` — Antigravity only: when `agy` is installed, paste the note the upgrade writes
  to `.state/updates/antigravity-user-config.md` into `~/.gemini/config/plugins.json` and
  `~/.gemini/antigravity-cli/settings.json`, then start `agy` from the home.

## [1.1.0] - 2026-11-24

Less loads into every session, and the brain's upkeep is measured instead of guessed.

### Added
- The session banner says how much loads into every session for the host it runs on, in one line
  over the list of what the start hook adds: "121.1KB of home files and 7.7KB added today:". Over
  the 100 KB budget, the log (not the banner) names the three largest files; the status screen and
  the dashboard weigh the same total.
- The compile records the operator's corrections from the session logs: each quoted with one line
  of scope, keyed on its session, and never appended twice.
- Self-review scripts: `rule-compliance.ts` counts corrections per 1,000 replies and two shell
  habits per week from a home's transcripts; `replay.ts` asks one prompt of the manual at two git
  refs and scores the answers blind; `feedback-digest.ts` reads the feedback log by code, so a
  rules pass reads a few KB of it instead of all of it.
- The brain audit reads every file a session loads and finds lines said twice, lines naming only
  closed tasks, and rules buried in their incidents, plus memory lines that only report a heartbeat
  look or refresh. A lead the operator kept stays quiet while its text is unchanged.
- A release's Upgrade block can name a skill the upgrade runs before its closing sync
  (`skill: required`), or right after the restart when it ends on one.

### Changed
- The manual is 28,810 bytes, down from 35,363. "Engineering the Codebase" (the plugin's own
  contributor rules) is gone, and the folder tree, the principles and the worktree section are
  shorter. On a correction the agent fixes the work and writes no lesson mid-task; the compile
  records the correction.
- The always-on Xcode rule is 5,462 bytes, down from 13,253. It keeps the toolchain routing,
  headless recovery and the ground rules; previews, the oldest-OS launch check, what to do after an
  Xcode update and Apple's skills move to `xcode-project.md`, now scoped to Swift sources too.
- TASKS.md lists the P0 and P1 tasks, what is blocked or overdue, and one line of counts per
  project; the full Active list, the stale ids and Recently Closed leave it (30.6 KB to 10.7 KB on a
  home with 96 open tasks). The flywheel takes its queue from `task_query`.
- Memory budgets: Recent Decisions covers a week (15 one-line bullets, 5 KB); a new Learning is one
  line of at most 250 characters, and a longer one is kept word for word until self-review splits
  it; a knowledge index entry is one line of at most 200 characters, and the compile shortens up
  to ten long ones a run after moving what they say into the article. Lint checks every memory
  section and the index.
- Self-review's rules pass ranks what it prunes by harm (wrong, said twice, narrative, low value,
  then size), takes one yes for the items its scripts settled, proposes up to three retirements a
  sitting, holds additions to the budget, and opens its report with a scorecard. Sync also offers
  it seven days after the last rules pass, once a home has had one, when the loaded files and the
  memory hold 5 or more such lines the operator hasn't kept, or the home is over its budget. That
  check reads only those files, never the session logs.
- Codex: the Codex setup writes `project_doc_max_bytes = 65536` into a home's `.codex/config.toml`
  when the key is absent, and the upgrade reruns that setup in a home that uses Codex. Codex reads
  only the first 32,768 bytes of `AGENTS.md` by default: a session in a home whose manual was 36,999
  bytes lost its last 4 KB, and Codex logged the cut. Whether Codex honours the key from a home's own
  config, rather than the user's, is not yet confirmed.
- A release entry gives the before and after size of an always-loaded template it changes.

### Fixed
- The heartbeat's own runs no longer reach the brain. Every look and brain refresh was captured like
  a working session (each with the whole proposals skill), compiled into daily memory as "proposal
  looks: nothing new worth proposing", and, when the heartbeat ran last, injected into the next
  session as its last-session memory. Capture now knows them from Claude Code's own record of who
  started each prompt and what it ran, whatever the run's wording, and drops them; a prompt
  queued as the operator's words or a button they pressed is kept. Which runs are background is one
  list the heartbeat also issues them from. Session logs already on disk are filtered by the same
  list before the compile and the session tail read them.
- Heartbeat: a look that starts late (a timer firing in a brief wake of a sleeping Mac) waits two
  minutes for the machine to stay awake, and a re-arm in that wait no longer drops it; an idle home
  gets no wake, a due brain refresh included; a brain refresh that never finished is retried once
  at the next look, and a `/clear` no longer resets that. A late look is marked in the CLI log.
- Capture: one stopped between its append and its index save is not written twice. A capture now
  saves its block as pending before appending, and a block cut short mid-append is trimmed before
  it is written again.
- Feedback: two copies of one keyed entry captured at once are appended once; a reply quoting a
  role label at the start of a line no longer reads as an operator turn; a capture cut inside a
  multi-byte character of its header is trimmed.
- An `@-import` naming a folder no longer aborts the banner's weight and the dashboard rebuild.
- One sync, brain refresh or compile runs in a home at a time. Two at once (a sync started twice by
  accident, or the heartbeat's refresh coming up during a sync) compiled the same session into
  memory twice. Sync and `knowledge-compile` now take a lock (`.state/sync.lock`) at their start
  and free it at their end; a second run asks the operator to wait or take over, the heartbeat
  skips its refresh while the lock is held, and a run with no progress for an hour loses the lock,
  so one that stopped never blocks the next.

### Upgrade
- `script: required` — run skills/upgrade/scripts/1.1.0.ts: removes "Engineering the Codebase" from
  `AGENTS.md` when unedited, and replaces the Xcode pack's two rule files together when both are
  the shipped copies. Anything you edited is left as it is and put to you. It also takes out of the
  daily memory files the bullets that only report a heartbeat look or brain refresh, and a section
  they leave empty; a bullet with code or a commit in backticks stays, and every removed line is
  in its report.
- `template/AGENTS.md: mandatory` — the trimmed manual and the new correction rule.
- `manual: optional` — Xcode pack only: if the upgrade reports your `xcode.md` or
  `xcode-project.md` as edited, merge them with the plugin's `templates/rules/` copies by hand.
- `manual: optional` — If a session is your heartbeat, restart it and run `/heartbeat` there: the
  late-look and retry fixes run only in a session started on 1.1.0.
- `skill: required` — self-review, before the sync: the first quality-first sitting. Its verified
  list includes the heartbeat looks and refreshes still in the memory index, cleared with one yes.

## [1.0.11] - 2026-11-23

The cmux sidebar is one page, and a heartbeat look that changed nothing stays quiet.

### Changed
- The cmux sidebar is one page: the cmux Manager's header and tallies over four tabs, Sessions,
  Projects, Reports and Recent, each for the agent of the selected workspace (cmux-custom-manager
  0.5.0). The Manager/Agents switch and the agent chips are gone. INBOX sits on Sessions, whose
  search row carries the dashboard, roadmap and Finder buttons; a switch beside the Projects search
  shows the goals. The sidebar opens on Sessions.

### Removed
- `cmux sidebar order`: it ordered the agent chips, which the sidebar no longer has.

### Fixed
- A heartbeat look that adds or retires no proposal and sends no note ends without cmux's done
  notification or its waiting-for-input reminder. A look that changed something, and every turn you
  type, ends as before.
- `remove_worktree` (and `worktree remove`) no longer asks for `force` when the branch's commits are
  already on a local `dev`, `develop`, `main` or `master`, such as a branch fast-forwarded into an
  unpushed local `main`.

### Upgrade
- `deps: required` — `cmux-custom-manager` moves to `2ec4672` (0.5.0); run `bun install` in the
  plugin root.
- `manual: optional` — If a session is your heartbeat, restart it and run `/heartbeat` there: the
  quiet look runs only in a session started on 1.0.11. The sidebar takes its new layout at the next
  dashboard refresh or sync.

## [1.0.10] - 2026-11-23

The heartbeat sends notes as well as proposals, both land in one INBOX, and each host gets the plugin in its own terms.

### Added
- Notes: short findings the agent checked, each with one next step, at most three a day. The
  heartbeat scouts after each brain refresh, one lens a run, each in an agent of its own so the
  heartbeat's tab is never cleared for it: a home lens (the brain against itself, what waits on you)
  reads the home and reaches no web; a web lens runs in a separate scout on Sonnet that sees only
  `knowledge/public.md`, the facts you approved for web searches, and no `CLAUDE.md`; it reads what
  is current from each product's own store listing or changelog, so the list needs no update on a
  release (the code refuses a version number in a fact). No model can
  start either agent, and the scout's searches can't carry an email address or the home's private
  folder names. Scouting is off until you approve that list (`AGENT_NOTES_SCOUT=true`).
- `note_add`, in the always-on core: refuses past the day's cap, a source noted in the last two
  weeks or one you dismissed, and a note with no source (a URL or a home file). Every note lands in
  `reports/notes/`; with the heartbeat in a cmux tab it also posts a desktop notification that opens
  that tab (a plain macOS notification without one). `AGENT_NOTES_DELIVER` (adapter names,
  comma-separated) narrows where else notes go.
- A Notes walk in `configure-skills`, offered by init: drafts `knowledge/public.md` from the home,
  leaves out anything not already public, writes it on your yes, checks what the code keeps with
  `notes public`, then turns scouting on. The compile never writes that file.
- `/heartbeat scout` runs one scouting pass now, in the heartbeat's tab. Binding a heartbeat and
  `/heartbeat status` say how to turn notes on while they're off, or how to add the web while only
  the home is scouted.
- The cmux sidebar's INBOX: proposals and notes in one section, scoped to the workspace's agent,
  folded by default, each card led by a Proposal or Note badge and reading what, why now, limits.
- A Recent section on the sidebar's Agents tab: the home's 40 newest changed files from the last
  30 days, by day, with a search; a file this conversation writes shows within seconds. Finder
  buttons open the home's folders.
- The CLI's `heartbeat` (`status`, `bind`, `release`, `off`), `messages decide`, `notes list`,
  `notes brief` (hands out a scouting run) and `notes public` (what the code keeps of `public.md`).

### Changed
- One `/message <start|later|dismiss> <id>` decides a proposal or a note; Skip is Dismiss everywhere.
  `messages decide` replaces `proposals decide`, and `heartbeat bind|release|off` replaces
  `proposals heartbeat`. A heartbeat bound on 1.0.9 carries over on its own.
- The heartbeat is its own domain and mod (`mods/heartbeat`). Start on any message opens where the
  work fits, else the focused workspace when it isn't another agent's, else the agent's own.
- What differs between Claude Code and Codex lives in one adapter per host, with one session start
  for every host. Codex reads the skills' Claude Code terms (tool names, the question tool,
  subagents, `/agentlayer:<name>`) through a glossary in its session start, and runs skill scripts
  from the checkout its hooks run from.
- `upgrade` flags a Codex copy of the plugin older than the plugin (`stale-copy`), with the commands
  that refresh it.
- Captures queued while another capture ran are written at the next session start on Claude Code
  too, as on Codex.
- `home_history` regenerates the Codex wiring only for a home wired for Codex (`.codex/hooks.json`),
  not one that holds only a `.codex/config.toml`.
- The tasks summary rides the folded Tasks card; the Discuss sparkles are yellow.
- The shell guard refuses a command that writes to an inline `$(mktemp …)` (a redirect, `tee`, a
  copy's target): the path is never kept, so nothing can read what was written without running it
  again. A path held in a variable first (`O=$(mktemp …) && … > "$O"`) still runs.
- The manual's Workflow rules add: read a default branch's protection rules before handing over a
  push; "isolated" and "survives a clear or restart" are claims that need a probe; a merge-based PR
  stack commits and merges up after its gate; a claim about a code path starts at every entry that
  reaches it; a brief to another agent restates its hard rules; read the code and its history before
  calling something broken. Production data stays at its host unless you agree otherwise, a new
  section covers docs the team reads, and a diff touching auth, regulatory logic or money keeps its
  safety checks easy to see.

### Fixed
- A bare `/heartbeat` in the heartbeat's own tab reports its status instead of rebinding at 55m.
- A `/clear` no longer makes the tab forget it is the heartbeat.
- The heartbeat's two clocks restart each other when the host ends one, so looks no longer stop
  overnight in a live session; a look that found nothing draws the quiet mark however its line ends.
- A prompt that starts with `-` can never become a flag; a note's Start opens on what the card
  showed, under a drafts-only line the code adds, never on a prompt the scout wrote.
- A killed or slow capture drain no longer loses or replays the queued captures.
- Session start no longer prints git's "not a git repository" when the knowledge folder isn't one.
- A day with no report yet, or a home with no session in the last week, shows as empty (○) at session
  start and on the dashboard instead of missing, so it no longer logs the session start as a warning.
- `TASKS.md`'s Recently Closed keeps the tasks sync archived, so it no longer empties at every sync.
- A per-session context that fails to build costs only that context: the banner says so and the
  session starts with the rest, where Claude Code used to get an empty start. The setup banners are
  plain text outside a terminal.
- A Codex question no longer disappears: Codex asks in chat unless it is in Plan mode.
- A team plugin's skills under Codex keep their own `${CLAUDE_PLUGIN_ROOT}`.
- A helpdesk profile's `## Pulse` can post its private notes without asking, as a workflow can.
- Skills no longer look for an `extensions/` folder the home doesn't have when session start listed
  none (an `ls` that failed on every heartbeat bind), and the manual says so too, so a Codex session
  no longer searches for one before running a skill.
- A `bun test` started outside the plugin checkout, which never loads the test preload, stops at its
  first home read instead of resolving a real home (and loading its secrets).

### Upgrade
- `settings: mandatory` — add `mcp__plugin_agentlayer_agent__note_add` to `permissions.allow` in
  `settings.json`.
- `template/AGENTS.md: mandatory` — the tree's `extensions/skills/` line says extensions are listed at
  session start only when the home has any, so none listed means none to look for; the Workflow,
  "Ask first", Code quality and new "Docs the team reads" rules listed under Changed.
- `manual: required` — If a session is your heartbeat, restart it and run `/heartbeat` there: the
  heartbeat's new mod (notes, the INBOX's actions, the fixes above) runs only in a session started
  on 1.0.10, and a restarted session is the heartbeat again only after `/heartbeat`.
- `manual: optional` — Notes stay off until you approve the public facts the web scout may search
  with: run `/agentlayer:configure-skills` → Notes. Without it the heartbeat keeps proposing as
  before.
- `manual: optional` — Renamed: `proposals decide` → `messages decide`, `proposals heartbeat` →
  `heartbeat bind|release|off`, `/proposal` → `/message`, `skip` → `dismiss`. A heartbeat bound on
  1.0.9 carries over; only your own scripts or aliases need the new names.

## [1.0.9] - 2026-11-21

The heartbeat shows what it is doing, keeps the best five proposals instead of stopping at five, and keeps the brain fresh between syncs.

### Added
- A band above the heartbeat's prompt: what it is doing now (looking for proposals, refreshing the
  brain) or a countdown to the next look, yellow when a look is overdue; the interval, the
  proposals showing and the brain's age; and the last three ticks, each with a mark (✓ proposed,
  · nothing new, ↻ refreshed, – skipped, ✗ stopped), repeated skips folded into one line.
- A brain refresh, `/agentlayer:sync brain`: sync's maintenance steps (snapshot, code, compile, lint,
  prune, links, the flywheel, the dashboard and sidebar, history) with none of its questions,
  briefings or reviews. The heartbeat runs one when six hours have passed since the last sync or
  refresh and a session has written since, clearing its conversation first; `/heartbeat now` runs
  one when it is due. It stamps its own watermark, so the full sync's nudge keeps nudging.
- Sessions the sidebar opens (Discuss on a task or goal, a proposal's Start, Start heartbeat) land in
  the agent's own workspace that fits the work, selected and focused: one the heartbeat named for
  the proposal, the work's folder, a project's name, or the kind of work in the title. With no fit,
  they open in the agent's own workspace, never another agent's.
- `list_sessions.ts --brief`: one line per session (id, age, branch, topic, latest ask).

### Changed
- The heartbeat looks whether or not five proposals show. `proposal_add` takes `retire` (with an
  optional `for`) to withdraw cards a stronger candidate outranks, a live session already covers, or
  that no longer hold, in the same write as the adds; a card retired for a replacement that is
  refused stays. Every look gathers candidates, leaves out work a session started in the last six
  hours, names each proposal's folder and workspace, and ends on one line.
- After each look or refresh the heartbeat rebuilds the dashboard and the cmux sidebar.
- The sync tracker draws a brain refresh's own nine phases under its name, keeps it out of the
  full-sync history, and clears it when it ends.
- The sidebar's Discuss sparkles are no longer dimmed.
- To show you a file, the agent puts its absolute path in the reply, which the terminal makes a link
  you Cmd-click (Ctrl-click off macOS) to open in your default app, instead of handing you an
  `! open` command.

### Fixed
- Leaving the heartbeat's session (exit, logout, a closed tab) gives the heartbeat up, so the next
  `/heartbeat` no longer reports taking over from a session that is gone; after a crash it says it
  replaced an earlier heartbeat that stops at its next tick if still open.
- A proposal's publish read the last saved work model, so it could put an old tasks summary back on
  the sidebar; it now scans the task files.
- `/heartbeat now` checks the live owner before clearing, and a refresh that fails before it stamps
  isn't retried until its window passes.
- A word typed after a `/proposal` decision is no longer taken for a workspace.

### Upgrade
- `template/AGENTS.md: mandatory` — Platform's "Keep the live home out of harm's way" paragraph
  shows a file as its absolute path to Cmd-click, never an `! open` command.

## [1.0.8] - 2026-11-21

The heartbeat follows the home instead of the clock, and the PROPOSED list waits until you open it.

### Changed
- The heartbeat no longer sleeps 23:00–07:00. A wake goes ahead only when another session in the
  home wrote to its transcript within the interval (syncs and agent-run sessions count); a session
  that keeps no transcript keeps waking. `/heartbeat status` says when another session was last
  active.
- `/heartbeat`, with or without an interval, looks for proposals at once at any hour, then waits a
  full interval. Its reply says whether it looked, or why not.
- The cmux Manager's PROPOSED section starts folded and no card opens on its own. A closed card shows
  why it's there under its badges; opening it shows the details and buttons. The Start heartbeat card
  describes the new wake (cmux-custom-manager 0.4.5). The sidebar picks this up on its next sync or
  dashboard refresh.

### Upgrade
- `deps: required` — `cmux-custom-manager` moves to `f885f86` (0.4.5); run `bun install` in the
  plugin root.

## [1.0.7] - 2026-11-20

The setup guide installs the release it names, never what happens to be on `main`.

### Fixed
- `install.sh` and `install.ps1` download their steps from the release tag (`RELEASE`, `$release`)
  instead of the `main` branch, so a push to `main` no longer changes what a new user runs before
  it's released. A test fails when either line lags the plugin's version.

### Changed
- The release skill bumps the setup guides' release line along with the manifests, and its docs
  pass notes that the site's plugin facts wait for the release tag.

### Upgrade
- None — code-only, no bun install or HOME changes.

## [1.0.6] - 2026-11-20

Proposals: the agent lines up sessions worth starting, and one heartbeat session per home keeps
them coming.

### Added
- Proposals: sessions the agent has prepared and waits on a yes for. Start opens a fresh session that
  runs the proposal's prompt, Later brings it back at 08:00, Skip drops it. A source already waiting,
  started in the last day or skipped in the last week is never proposed twice, and the backlog stops
  at 20. The list lives in `.state/proposals.json`.
- `proposal_add`, the tool that adds proposals, and a `proposals` CLI group: `proposals list`,
  `proposals decide <start|later|skip> <id>` and `proposals heartbeat`.
- The heartbeat: `/heartbeat [15m | 2h | off | now | status]` makes one long-running session the
  home's heartbeat. It looks for proposals at once, then every 55 minutes (or the interval you set),
  only while the session is idle, outside 23:00–07:00 in the home's timezone, and while fewer than
  five are showing and the 20-proposal backlog has room. `/proposal <start|later|skip> <id>` decides one without a model turn.
  Both are Claude Code mods; the heartbeat follows its session across `/clear` and `/resume`, and a
  takeover by another session says so on both sides.
- The `proposals` skill is the heartbeat's wake: it looks at tasks, sync, GitHub and every proposal
  source skill, then tops proposals back up to five. It proposes only, and never starts, sends or
  edits anything. A proposal source is a skill named `proposals-<topic>` whose description starts
  "Proposal source:"; the contract is in the skill's `references/sources.md`.
- The cmux Manager shows a PROPOSED section above Needs you, across every home on the Mac. Its
  buttons type the decision into that home's heartbeat tab, a started proposal opens as a tab beside
  the heartbeat, and a home without a heartbeat gets a card that starts one.
- A Discuss icon on every task and goal in the cmux sidebar opens a session on the new `discuss`
  skill: where the task stands, what's unknown, the ways forward, then a choice of next move, with
  nothing built first.
- A tasks-at-a-glance summary in TASKS.md, one line written by sync (and by the heartbeat once it's
  six hours old). The sidebar shows it above Tasks, and the dashboard's Attention tab opens on it in
  the goals banner.

### Changed
- The sidebar opens a session one way everywhere: a tab where you are, or a new workspace in the
  home when no workspace is selected or the selected one can't take a tab.
- The Manager's session titles take two lines, section headers line up with their cards, badges drop
  their dots, and a section's fold follows the data as it arrives (cmux-custom-manager 0.4.4).
- The release skill offers a docs pass after the release: it finds the docs site beside the plugin,
  plans every page the release touches (shown in the question, with every changelog line covered),
  and regenerates the plugin facts and the demo dashboard. It no longer offers to push either repo;
  pushing is the maintainer's once they've checked.
- The README's skill, playbook and tool counts are checked by a test.

### Fixed
- Task titles in the cmux Agents tab take two lines, like reports.
- A task's project pill truncates, so an open Tasks card no longer widens the sidebar.
- The sidebar's tasks summary is one short themed sentence, and its banner stops at three lines.

### Upgrade
- `deps: required` — `cmux-custom-manager` moves to `2a8eb8e` (0.4.4); run `bun install` in the
  plugin root.
- `settings: mandatory` — add `mcp__plugin_agentlayer_agent__proposal_add` to `permissions.allow`
  in `settings.json`.
- `manual: optional` — Proposals need a heartbeat. In Claude Code, run `/heartbeat` in one session
  you'll leave open in the home (in cmux, the PROPOSED card starts one for you). Without one, nothing
  is proposed on its own and nothing else changes.
- `manual: optional` — In the cmux sidebar, each agent on the Mac shows "needs its agent updated"
  until its next sync or dashboard refresh rewrites its part of the sidebar.

## [1.0.5] - 2026-11-19

Files open in your own apps: dashboard links go to the file itself, and the installer sets up the editors.

### Added
- The installer checks for Node.js before Bun, on Mac, Linux and Windows. Any Node on PATH passes,
  and so does fnm's default Node; otherwise the step links to fnm and shows `fnm install --lts`.
- The Mac guide recommends MarkEdit for the agent's notes, right after CotEditor.
- A Default apps step in the Mac guide checks that CotEditor opens `.txt` and `.json` and MarkEdit
  opens `.md`, asks only about the editors that are installed, and lists the Get Info steps for each
  missing kind.

### Changed
- Dashboard file links open the file itself in a new tab by default, on the dashboard, the
  attention pages and the radar's session rows. `MARKDOWN_URL` no longer defaults to Obsidian;
  set it (`obsidian://…`, `markedit://…`) to route links through an app. A value without a scheme
  and `{path}` falls back to plain file links.
- The manual tells the agent to show you a file with `! open <absolute path>`, so your system's
  default app opens it, never an app's link scheme or `open -a` unless you named the app. The init
  and dashboard skills stop naming Obsidian as the way to read the home.
- The radar report is sanitized before its task and plan links go in, so the report's own app or
  file links are stripped while the dashboard's links stay.

### Fixed
- The demo dashboard's week starts on its own Monday, not a day early when the machine's clock is
  already on the next day.

### Upgrade
- `template/AGENTS.md: mandatory` — Platform's "Keep the live home out of harm's way" paragraph
  gains the rule to show a file with `! open <absolute path>`.
- `manual: optional` — Dashboard links now open the file itself instead of Obsidian. To keep
  opening notes in Obsidian, add `"MARKDOWN_URL": "obsidian://open?path={path}&paneType=tab"` to the
  `env` block of `.claude/settings.local.json`, then refresh the dashboard.

## [1.0.4] - 2026-11-19

The cmux sidebar in the order you choose, refreshed on request, and reports by their last edit.

### Added
- `cmux sidebar order <agent>…` puts the named agents first on the cmux sidebar, in that order
  (by agent name in any case, or by home folder when two share a name); the rest keep their order.
  The order holds through every home's refresh, and a new home joins last.
- "Refresh my sidebar" refreshes the cmux sidebar alone in one dashboard call, with no session scan
  first. The dashboard tool runs outside the shell's sandbox, so it can write the sidebar where the
  CLI run from a sandboxed shell can't.

### Changed
- The dashboard tool returns `sidebar` (`written`, `unchanged`, `not-installed`, `not-joined` or
  `failed`), so the agent can say how the sidebar refresh went.
- The dashboard's Reports page and the sidebar's reports list sort by when a report was last
  updated, so a report edited after the day it was filed moves up. The radar, the Today feed and
  session start still go by the filed day.
- The sidebar keeps its agents in the order they joined instead of sorting them by folder.
- The README leads with what the plugin is, the cmux workstation and the one-line installer.

### Fixed
- Three short-named agent chips fit beside the cmux sidebar's tab pill instead of the third
  wrapping to a second line.

### Upgrade
- None — code-only, no bun install or HOME changes.

## [1.0.3] - 2026-11-18

The guided installer, an agent's own colors, skill extensions, and homes that keep their pages as files.

### Added
- A guided installer for macOS, Linux and Windows: `curl -fsSL https://agentlayer.one/install.sh | bash`
  (`irm https://agentlayer.one/install.ps1 | iex` on Windows). It only looks: it runs read-only checks,
  shows each step with the vendor's page or the exact command, waits while you run it, and ticks it on
  the re-check, so on a machine that's set up a run is a column of ticks. It opens with Oppi's banner
  and a menu (set up an agent, prepare this machine, check it); `--prereqs` (`-Prereqs` on Windows)
  prepares a machine without setting up an agent. Two paths are asked first: use the agent from the
  marketplace, or develop the plugin from a local clone.
- Every agent has its own colors: a primary and an accent on a `Colors` line in IDENTITY.md, chosen
  at init from four pairs (or changed with rename-agent) and drawn in the session banner, the
  dashboard's wordmark and the cmux sidebar's agent chip. A home without the line keeps Oppi's
  orchid and mint. The `colors` CLI verb shows the pairs; `--line` prints the exact line.
- A home extends a plugin skill from `extensions/skills/<skill>.md`: session start lists each one,
  the skill reads it before it runs, and the extension wins where the two disagree. A home with
  none adds nothing to the context. Seed export and import carry the folder.
- A home's own report categories: `report_write` takes any kebab-case folder except `captures`,
  and the dashboard lists the plugin's categories first, then the home's. An `.html` report is
  written as it is, with no frontmatter.
- The morning brief flags a red CI run on the code repo's default branch (with the GitHub pack and
  a code repo set up; a passing run adds nothing).
- A browser flow's target can carry its own Chromium flags, added after the shared ones.
- The read-only `cmux settings` verb compares a Mac's Ghostty and cmux configs with the recommended
  ones and prints what's missing, without writing either file; the installer and configure-skills'
  cmux step use it.

### Changed
- Homes keep their pages as files: init writes `"enableArtifact": false` to the home's
  `settings.json`, so Claude Code's Artifact tool no longer publishes the home's pages and plans
  to claude.ai. The manual's routing table says where a page asked for outside a skill goes.
  Set the value to `true` to have Artifacts back (project settings can only turn them off).
- Codex homes default to `gpt-6.2-sol` at high effort. A user-global Codex config still on a past
  home default is shown the line that replaces it, marked `# replaces`.
- Helpdesk's org rules come from the home's `extensions/skills/helpdesk.md` instead of a
  `references/org.md` beside the skill.
- Per-agent billing and `agent`: the installer's closing start line says `agent` for a home with
  its own Claude subscription and `claude` for the others; the cmux settings check recommends
  `agent` for the Claude Code button when a home has one; init's billing step says to switch the
  button too.
- The session banner's Agent line leads with the agent's emoji.
- A home moved in place (same folder, new plugin) reads as moved from that plugin, not copied,
  and the move check skips its stale-path scan.
- The seed wizard on agentlayer.one is retired; a seed bundle comes from a teammate's export. A
  bundle the wizard made still imports.
- The work model and the cmux sidebar entry carry the agent's colors, so both schemas move up one;
  each home rewrites its own on its next refresh.

### Fixed
- Pack pickers in init and configure-skills listed up to eleven packs in one question, so packs got
  merged into shared options; each picker now asks three questions with every pack its own option.
- The Windows installer names a tool by its full path when the window you started it in can't find
  it yet, for every command it shows, not only the last one.

### Upgrade
- `script: required` — run skills/upgrade/scripts/1.0.3.ts (a Codex home whose `.codex/config.toml` sets `model = "gpt-6.1-sol"` moves to `gpt-6.2-sol`; any other model, and a home with no Codex config, is left as it is).
- `template/AGENTS.md: mandatory` — a routing row for a page or document asked for outside a skill, and `extensions/skills/` in the home's tree.
- `settings: mandatory` — upgrade's baseline reconcile adds `"enableArtifact": false` to `settings.json` when neither home settings file sets `enableArtifact`. Applied automatically; set it to `true` to keep Artifacts.
- `manual: optional` — a home whose agent isn't Oppi shows Oppi's colors until IDENTITY.md has a `Colors` line under `## Who`. To pick a pair, ask the agent to "show me the color pairs and set mine": it shows the four with the plugin's `colors` verb and writes the line `colors --line=<choice>` prints below the `Emoji` line.
- `manual: optional` — with the cmux pack, every other home in the sidebar shows "needs its agent updated to show here" until that home runs `/agentlayer:upgrade` (or a dashboard refresh) on this version.
- `manual: optional` — an organisation plugin that ships helpdesk org rules at `skills/helpdesk/references/org.md` no longer has them read: move that file's text into each home's `extensions/skills/helpdesk.md`.

## [1.0.2] - 2026-11-17

The cmux pack: an AgentLayer sidebar in cmux, fed by one model of the home's projects and tasks
that the dashboard and TASKS.md now read too.

### Added
- The cmux pack (macOS, cmux 0.65.2 or later): an AgentLayer panel in cmux's right sidebar that
  every agent home on the Mac can join. **Manager** lists every agent session, sorted by what
  needs you. **Agents** has a chip per home and three tabs: Projects (task search, a Tasks card
  with what's overdue and due this week, projects grouped at work, blocked and quiet), Reports
  (pins, then the newest reports by day) and Goals (today through the year). The dashboard and
  roadmap open as full tabs. Set it up with configure-skills; there are no keys or permissions.
- `cmux sidebar install | refresh | remove` CLI verbs, and every dashboard refresh keeps the
  sidebar current.
- init offers the Helpdesk, App Store and cmux packs with the others; cmux is ticked by default
  when init runs inside cmux.
- A report's status shows as a word with a coloured badge, on the dashboard and in the sidebar.

### Changed
- One work model of the home's projects and tasks, read once per rebuild and kept in
  `.state/work.json`; the dashboard, TASKS.md, `task_scan` and the sidebar all derive from it,
  with one priority order, one set of due-date words and one reading of a date.
- The dashboard's Goals read like the sidebar's.
- Outside Obsidian, the dashboard opens HTML pages as pages in a new tab.
- The agent rows under the prompt are drawn by a mod, since Claude Code 2.1.323 removed
  `subagentStatusLine`; they show the agent type, its description and a context bar.
- The plugin declares Claude Code 2.1.314 or later, so an older host skips it rather than
  half-loading it, and names the AgentLayer logo as its icon.

### Fixed
- Dashboard writes run one at a time, each from the files as they are, so two refreshes can't
  overwrite each other.
- The sidebar reads its file back whatever its titles hold, and keys a project's links by where
  they go rather than their title.

### Removed
- The plugin's `subagentStatusLine` setting and the `statusline --subagent` renderer, which
  printed a deprecation warning at every session start.

### Upgrade
- `deps: required` — new dependency `cmux-custom-manager` (the sidebar's library); run `bun install` in the plugin root.
- `manual: optional` — on macOS with cmux 0.65.2 or later, run `/agentlayer:configure-skills` and pick cmux to put this home in the AgentLayer sidebar.

## [1.0.1] - 2026-11-16

A hardening release: fixes from a full review of the plugin and a second model's adversarial
review, a reorganised source tree, and a moved home that checks its move before finishing it.

### Added
- A moved home's first session checks the move with you before the upgrade and the sync
  rewrite its lines: it reads the change list the move saved, flags renames that meant someone
  else, and puts back the ones you pick. It then lists what is left of the move note's
  checklist.
- `upgrade` flags a home missing from the auto-mode "Agent homes:" entry, and a Codex-wired home
  whose Codex has no `agentlayer` plugin.
- A new home that keeps the name Oppi gets its nickname, Ops.

### Changed
- `curl_run` accepts a listed set of request flags and one URL per call, and reads no `.curlrc`,
  instead of refusing known-bad flags.
- Every outbound request has a deadline and stops when its call is cancelled.
- Codex wiring is named after the plugin: `[mcp_servers.agentlayer]`, `[permissions.agentlayer]`
  and `.codex/rules/agentlayer.rules`, so it no longer shares the bare `agent` name with your own
  Codex config.
- Source layout: each domain owns its `tool.ts` and one registry imports them; only entry points,
  config and the registry sit at the `src/` root; `shared/` holds cross-domain code only; hook
  verbs live in `src/hooks`. The paths a home stores (`src/cli.ts`, `src/server.ts`) are
  unchanged. The repo has a contributor manual (`AGENTS.md`).
- The README leads with AgentLayer and introduces Oppi; the changelog notes that `agent-kevin`
  ends at 0.9.5.

### Fixed
- Security: tool paths that could write outside the home or hand out its secrets; curl's
  `--next` and `--variable` bypasses; the secret store's keys reaching child processes; Slack
  messages now wrapped as untrusted, like every other outside source.
- Capture: the session briefing is redacted (the whole first turn, before it is cut); three ways
  a capture lost turns; an inbox item's frontmatter reads back whatever the file is called.
- Session start: the size cap never cuts a warning, and the session tail is where the session
  ended, keeps its role label and stays within its cap.
- Tasks: five ways a task file lost data or a task went missing.
- Knowledge: feedback logged mid-compile stays pending, and prune repoints the days it deletes.
- The CLI reads the named home's settings, survives a mistyped time zone, and keeps a note that
  starts with `--`.
- A report's title, summary or extra key can't break the report or its index line.
- Atomic rewrites keep the file's mode; `.env` files read `export` lines; one cadence writer,
  which never replaces a damaged file.
- The GitHub sweep compares "new since the last sweep" as instants, not strings.
- Four skill scripts that wrote or matched the wrong thing.
- A moved home's first session always syncs, even across a restart.

### Upgrade
- `manual: required` — only for a home wired for Codex on 1.0.0. The upgrade's `codex_setup` writes the new `agentlayer` tables but leaves the old ones: in the home's `.codex/config.toml`, delete `[mcp_servers.agent]` and `[permissions.agent]` and set `default_permissions = "agentlayer"`, then delete `.codex/rules/agent.rules`. A home without `.codex/` has nothing to do.

## [1.0.0] - 2026-11-15

The first release as `agentlayer`, with Oppi 🐙 as the agent a new home wakes up with. A home
moves here from `agent-kevin` with that plugin's `/agent-kevin:move`, which copies it to a new
folder; this release's upgrade then finishes the move.

### Added
- Oppi, the default agent: name, octopus avatar, and "Many arms, one brain" in SOUL.
- find-session searches the brain's session logs as well as Claude Code's transcripts, and
  loads a session it can't resume from this folder.
- A moved home's first session says where it came from, finishes the move, remembers it in
  Key Context, and offers the sessions noted for it.

### Changed
- The plugin is `agentlayer` and its MCP server is `agent`: commands are `/agentlayer:<skill>`
  and tools `mcp__plugin_agentlayer_agent__<tool>`.
- The package lives at the plugin root, and the CLI is `src/cli.ts`, run with `bun`; there is
  no `bin/` folder.
- The plugin root, its name, its version and the CLI path each come from one place.

### Removed
- Upgrade scripts and legacy names from the 0.x releases; a home arrives here through the move.

### Upgrade
- `deps: required` — the package moved to the plugin root; a checkout runs `bun install` there once.
- `template/AGENTS.md: mandatory` — the bundled server is `agent`, captures go through the `capture` tool, and the CLI line names `src/cli.ts`.
- `template/SOUL.md: optional` — a new core truth, "Many arms, one brain".
- `template/knowledge/concepts/audit-premise-decay.md: optional` — `/agentlayer:` names (already applied by the move).
- `template/knowledge/concepts/karpathy-wiki.md: optional` — `/agentlayer:` names (already applied by the move).
- `template/knowledge/concepts/markdown-native-task-management.md: optional` — `/agentlayer:` names (already applied by the move).
- `template/knowledge/concepts/self-evolution-loop.md: optional` — `/agentlayer:` names (already applied by the move).
- `template/rules/swift.md: optional` — `/agentlayer:` names (already applied by the move).
- `manual: optional` — for an agent that took the name Oppi: IDENTITY's Vibe can end "An octopus at heart: many arms working at once, one brain behind them." (the upgrade never edits IDENTITY's `## Who`).
