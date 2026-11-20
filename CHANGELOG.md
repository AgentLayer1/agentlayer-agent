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

- **kind** — `deps` · `settings` · `template/<file>` · `file` · `script` · `manual`
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

A code-only release writes a single line: `None — code-only, no bun install or HOME changes.`

`/agentlayer:upgrade` collects every Upgrade block from a HOME's recorded baseline
(`<HOME>/.state/version.json`) up to the installed version, coalesces them, backs up
touched files to `.state/updates/`, auto-applies the mandatory/additive/deps actions,
and prompts per optional one. The new template files are the source of truth for
*content*; these tags only say *which* files changed and *how aggressively* to apply.

<!-- Add new releases below this line, newest first. -->

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
