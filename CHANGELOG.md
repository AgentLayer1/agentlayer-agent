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
