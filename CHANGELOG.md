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
