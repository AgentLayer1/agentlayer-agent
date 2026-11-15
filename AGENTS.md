# agentlayer-agent — Agent Guide

The `agentlayer` plugin: an MCP server, hook handlers, a CLI, skills and mods that turn an agent CLI (Claude Code, Codex) into a personal agent with a markdown brain in its home directory. [CONTRIBUTING.md](CONTRIBUTING.md) has the contributor how-tos (adding a skill or a tool, local plugin testing, the demo dashboard); this file is what to know before changing code.

## Layout

| Path | What |
| --- | --- |
| `src/server.ts` | MCP server entry (stdio). Registers `TOOLS`, gates every tool on the home, enforces `askOnly` |
| `src/cli.ts` | CLI entry: hooks, the status line, and terminal commands. Dispatch only; `HELP` lists every verb |
| `src/tools.ts` | The tool registry: one import per domain's `tool.ts` |
| `src/config.ts` | Home paths (resolved live, never frozen), plugin identity, timezone |
| `src/bootstrap.ts`, `src/test.ts` | The server's first import (settings env), and the test preload that pins a throwaway home |
| `src/<domain>/` | One folder per domain or pack: `api`, `appstore`, `browser`, `database`, `github`, `helpdesk`, `home`, `knowledge`, `media`, `reports`, `seed`, `seo`, `slack`, `status`, `tasks`, `upgrade`, `worktree` |
| `src/hooks/` | Session start (context, banner), the shell guard, and `handlers.ts`, which speaks each host's hook protocol |
| `src/notices/`, `src/statusline/`, `src/roadmap/` | Banner and prompt-row notices, the status line, roadmap data |
| `src/shared/` | Cross-domain code only. A module with one consumer lives with that consumer |
| `src/contracts/` | Repo-wide tests: manifests, mods, skills, the old-name sweep, the tool registry |
| `skills/<name>/` | `SKILL.md`, `references/`, and `scripts/` (with their tests beside them) |
| `mods/` | In-process Claude Code mods; tested with `claude plugin test mods`, not `bun test` |
| `templates/` | Files scaffolded into a new home |
| `hooks/claude.json`, `.claude-plugin/`, `.codex-plugin/` | Host manifests |

## Tools

Each domain exports one `tools: ToolDef[]` from `src/<domain>/tool.ts`, built with `defineTool` from `@/shared/tool-def`. A small domain declares its tools there; a domain whose tools sit beside their logic (`github`, `database`, `browser`, `seo`) keeps those files and its `tool.ts` concatenates their arrays. A new `tool.ts` gets one import line in `src/tools.ts`. `src/contracts/tools.test.ts` fails on a module exporting `tools` that never reaches the registry (a sibling file a domain's `tool.ts` forgot included), a duplicate name, or an `askOnly` tool missing from init's baseline `permissions.ask`.

`src/status/collect.ts` imports the registry lazily, because the registry reaches it back through the status tools. Keep that import inside the function.

## Paths that never move

Installed homes store absolute paths to `src/cli.ts` and `src/server.ts` (the status line in `.claude/settings.local.json`, the Codex hooks and MCP registration in `.codex/`), and `statusline/setting.ts` and `skills/init/scripts/codex-setup.ts` match `src/cli.ts` literally to recognise their own entries. Moving either breaks every existing home. `const HELP` stays in `cli.ts`, since the dashboard parses it from the file. `src/config.ts` is imported by path from skill scripts and from the `tax` skill.

Skill scripts import plugin source by relative path (`../../../src/shared/naming`), so a moved `src/` module means updating them too; typecheck covers `skills/**/*.ts`.

## Commands

| Command | Does |
| --- | --- |
| `bun install` | Dependencies, plus Chromium through the postinstall hook |
| `bun run typecheck` | `tsc` over `src/` and `skills/**/*.ts` |
| `bun test` | Every test under `src/` and `skills/` (mods excluded) |
| `bun src/server.ts` | Boot the server; expect `MCP server started — tools=<count>` |
| `bun src/cli.ts help` | List the CLI verbs |

The gate before any commit is `bun run typecheck && bun test`, chained, never piped through `tail` or `grep`. Read the pass and fail counts: a pass needs a positive count, and the test-file count shouldn't drop.

## Rules

- **Bun only** for scripts and dependencies. Build paths with `node:path`, never by string.
- **Tests never touch a real home.** `src/test.ts` points `AGENT_HOME` at a temp tree; a suite that needs its own sets `AGENT_HOME` and restores the preload's value afterwards.
- **No real names in shipped files**: placeholders (`acme`, `Ada`) in skills, templates, tests and the CHANGELOG. `src/contracts/names.test.ts` also fails on the plugin's former name.
- **Product docs are host-neutral**: skills named bare, "your host" for the CLI, host-specific steps in per-host tabs.
- **Frontmatter the plugin writes is flat** (scalars and lists of scalars), so Obsidian shows it as properties.
- **Generated HTML pages share their chrome**: the theme switch (`src/shared/theme.ts`) and the diagram viewer (`src/shared/diagram-viewer.ts`) are synced into templates with `bun <file> sync`, and their tests fail until a template carries the current block.
- **Releases go through the `release` skill**: the version, the CHANGELOG entry with its `### Upgrade` block for home migrations, and the tag are one act. A pushed tag never moves.
