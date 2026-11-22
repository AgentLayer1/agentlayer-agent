# Contributing

Pull requests and issues welcome. Below is what we look for and the dev loop. [AGENTS.md](AGENTS.md) covers the source layout, the paths installed homes depend on, and the rules a change has to keep.

## Welcome contributions

- **New skill packs** that ship as opt-in via `/agentlayer:configure-skills`
- **New MCP dispatch tools** for external services (must follow the existing read-mostly + key-gated pattern)
- **Broader platform testing & hardening** — the agent runs on macOS, Linux, and Windows (native via Git Bash, and WSL2); more real-world testing and platform-specific fixes are welcome
- **Documentation improvements**, more use-case examples, screenshots
- **Translations** and regional-compliance notes

Open an issue before architectural changes — the agent's contract with `<HOME>/` markdown is intentional and worth preserving.

## Dev setup

```bash
git clone https://github.com/AgentLayer1/agentlayer-agent
cd agentlayer-agent
bun install         # installs deps + downloads chromium via the postinstall hook
```

Verify the MCP server boots:

```bash
bun src/server.ts
# expect: "agent MCP server started — tools=<count>"
```

Type-check:

```bash
bun run typecheck   # runs `tsc`
```

Verify a hook script:

```bash
bun src/cli.ts session-start --hook-protocol=claude
# expect: JSON with `systemMessage` and `hookSpecificOutput` keys
```

## Local plugin testing

From inside Claude Code:

```text
/plugin marketplace add /absolute/path/to/agentlayer-agent
/plugin install agentlayer@agentlayer-dev
```

After edits, run `/reload-plugins` inside Claude Code to pick up changes without restarting. New skills or hook scripts may require a full `/exit` and relaunch.

## Adding a new skill

1. Create `skills/<your-skill>/SKILL.md` with frontmatter:
   ```yaml
   ---
   name: your-skill
   description: One-line description of what it does and when to invoke it
   allowed-tools: <comma-separated list of tools the skill needs>
   ---
   ```
   Every skill is model-invocable: a skill the operator has to remember the slash name for is a skill they won't use, so the description front-loads the words people actually say (`Triggers on "…"`). Only a first-run wizard, a release cut, a whole-brain rewrite, and the two skills a session is opened on (`init`, `release`, `rename-agent`; the heartbeat's wake `proposals` and the sidebar's `discuss`) set `disable-model-invocation: true`, plus `agents/openai.yaml` with `policy.allow_implicit_invocation: false` (Codex ignores the frontmatter flag) and the one-line operator-only guard those carry. A pack skill stays model-invocable too: its playbooks name the key they need and stop at the first missing-key error, and anything that bills per call spends only on an explicit ask. Related skills are one skill with playbooks (`skills/<name>/references/playbooks/*.md`, a routing table in `SKILL.md`, a `references/help.md` menu), not siblings: `briefing`, `goals`, `seo`, `seed`, `project`, `attention` and `engineer` are the pattern.
2. Write the skill body as a markdown protocol the orchestrating Claude follows.
3. If the skill uses an MCP tool that needs a permission grant, add the tool name to `skills/init/SKILL.md`'s `permissions.allow` list so new installs get it pre-granted.
4. **Scratch files get a `mktemp` name, never a hand-picked one.** `$TMPDIR` resolves to `/tmp/claude-<uid>` — it's per-**user**, not per-session, so every Claude Code session running concurrently on the machine shares one directory. A fixed path like `$TMPDIR/prompt.md`, or one keyed only on a run parameter, will be silently overwritten mid-read by another session doing the same thing. Use `mktemp "$TMPDIR/<prefix>-XXXXXX"` (or `mktemp -d` for a directory); both work under the sandbox. No session-id env var is exposed, so there is nothing native to key off instead.
5. Test by re-running `/reload-plugins` and invoking the skill explicitly.

A skill that is part of the agent's standing capability set lives here in plugin source, never in one operator's `.claude/skills/`. Output meant to re-orient someone (session cards, digests) gets real sentences, three to five per item, not metadata fragments.

## Adding an MCP tool

1. Define it in its domain's `src/<domain>/tool.ts`, which exports one `tools: ToolDef[]` array. Use `defineTool({ name, description, inputSchema, handler })` from `@/shared/tool-def`. A new domain gets its own folder and `tool.ts`.
2. A new `tool.ts` gets one import line in `src/tools.ts`, the registry the server and the dashboard read. `src/contracts/tools.test.ts` fails on a module exporting `tools` that never reaches the registry, a duplicate name, or an `askOnly` tool missing from init's baseline `permissions.ask`.
3. Add the tool name to `skills/init/SKILL.md`'s `permissions.allow` list (use the `mcp__plugin_agentlayer_agent__<tool_name>` prefix). Pack-gated tools go in the matching `configure-skills` walk instead of the init baseline.
4. `bun run typecheck` and `bun test` must pass before submitting.

In the `mcpServers` entry of `.claude-plugin/plugin.json`, `env` entries hold only host-owned interpolations (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`) or literal values. A server already inherits the session's environment, so never redeclare a user variable as `"X": "${X}"`.

**Tests never touch a real agent home.** The root `bunfig.toml` preloads `src/test.ts`, which pins `AGENT_HOME` to a fresh throwaway tree for the whole run, so a suite that resolves a config path can't write into anyone's brain. A suite needing its own fixture home just sets `AGENT_HOME` (paths and secrets both resolve live, so import order doesn't matter) — save the preload's value and restore it afterwards rather than deleting the variable, or later suites fall back to resolving from cwd.

## Refreshing the demo dashboard

The public demo at agentlayer.one/demo/dashboard is rendered from a fictional home (Acme's agent Ace, operator Alex Chen) that `skills/dashboard/scripts/demo-home.ts` seeds from the real templates, dated relative to now. Rerun it whenever the dashboard or the templates change:

```bash
bun skills/dashboard/scripts/demo-home.ts --out <site-repo>/public/demo/dashboard.html \
  --avatar <site-repo>/public/demo/assets/ace-avatar.jpg
```

It renders in isolation (its own `HOME`, environment, and working directory), rewrites every temp and machine path to `/home/alex`, and refuses to write if any real path survives. The docs screenshots are taken from that file with `browser_screenshot` on `file://…/dashboard.html#<page>/<subtab>`.

## Proposals, notes and the heartbeat

Three words, kept apart: **the heartbeat** is the one long-running session per home and its clock (`/heartbeat`); **proposals** are sessions it prepares, **notes** are findings it sends, and both are **messages** to the operator, decided the same way (Start, Later, Dismiss) with `messages decide` and `/message`.

Proposals are sessions the agent prepared and waits on a yes for: Start opens a fresh session that runs the proposal's prompt (in cmux, a new tab in the heartbeat's workspace), Later brings it back at 08:00, Dismiss drops it. One long-running session per home, the heartbeat, tops them back up to five on its own clock.

| Piece | Lives in |
| --- | --- |
| The core: ledger (`.state/proposals.json`), the rules (dedupe by `source`, a backlog of 20, Later, decide once per id), `proposal_add`, the `proposals` CLI | `src/proposals/` |
| The launcher contract (`SessionLauncher`: `locate`, `start`), the launchers, and the one home redraw (`redrawHome`) | `src/sessions/launch.ts`, `src/adapters.ts` |
| The heartbeat's record (`.state/heartbeat.json`), its interval and refresh rules, and the `heartbeat` CLI (`status`, `bind`, `release`, `off`) | `src/heartbeat/` |
| `/message <start\|later\|dismiss> <id>` (a proposal `p-…` or a note `n-…`), `/heartbeat [15m\|2h\|off\|now\|status]`, the wake clock and the band | `mods/heartbeat/` |
| What a wake looks at (the `proposals` skill, slash-only), and the proposal-source contract | `skills/proposals/` |
| Notes: the ledger (`.state/notes.json`), the rules (at most 3 a day, a source not repeated for two weeks or once dismissed, open for a week), `note_add`, the adapters' contract, and the scouting skill that runs after each brain refresh | `src/notes/`, `skills/notes/` |
| Deciding any message by its id, whichever ledger holds it | `src/messages/command.ts` |
| The cmux launcher (Start as a new tab beside the heartbeat) and the Manager's INBOX (the messages section in code), proposals and notes in one list scoped to the selected workspace's agent | `src/cmux/launcher.ts`, `src/cmux/sidebar/messages.ts`, `src/cmux/sidebar/heartbeat.ts` |

The core never imports an adapter (a test fails if it does); `proposal_add` and the CLI take `LAUNCHERS` from `src/adapters.ts` and call `redrawHome` after a change. With no launcher that can reach the session, Start prints the command to run by hand.

**Adding a launcher** (a terminal multiplexer, an editor): add its place to the `SessionPlace` union and `parsePlace` (`src/sessions/launch.ts`), write a `SessionLauncher` in its own pack (`locate` from the environment the CLI inherits, `start` beside the place `locate` returned, from the prompt file without putting the prompt or the home's path in a shell string), and add one line to `LAUNCHERS`. A surface that shows the home (a hosted page) adds its redraw to `SURFACES` in the same file.

**Adding a note adapter** (Slack, email): write a `NoteAdapter` (`name`, `available`, `deliver`; `always` to run whatever the setting says, `group` to stand in for the others in the group) in its own pack, and add it to `NOTE_ADAPTERS` in `src/adapters.ts`. The report adapter always runs; `AGENT_NOTES_DELIVER` (comma-separated adapter names) narrows the rest.

**Scouting keeps the web and the home apart.** It is off by default: configure-skills' notes walk drafts `knowledge/public.md`, writes it once the operator approves it, and sets `AGENT_NOTES_SCOUT=true` in the home's settings (`note_add` works either way when a session calls it). `notes brief` picks the lens in code (`pickLens`). A home lens (`brain`, `waiting`) runs as the `notes` skill in the heartbeat's conversation, where the heartbeat mod refuses any call that reaches past the machine. A web lens runs in the `scout` agent (`agents/scout.md`: WebSearch, WebFetch and `note_add`, nothing else), which the mod spawns on a brief the code builds from `knowledge/public.md` alone (`src/notes/brief.ts` refuses emails, long numbers and links that aren't plain https). No model is offered the scout, its report never reaches a conversation, and its three tools run unasked. A home without `public.md` runs home lenses only. A note's Start opens a session on what the card showed (the title, body, next step and sources, which the scout may have written) under a drafts-only line the code adds; the operator reads the card before choosing Start. The scout can't read the operator's `extensions/skills/notes.md`; a rule for web lenses goes in the brief's facts.

**The wake** costs nothing until it runs: `/heartbeat` (with an interval or without) looks once at bind whenever there's room and its reply says whether it looked; then each tick on the clock, a full interval later, reads `heartbeat status --json` and wakes only when this session is the heartbeat (by a token its process picks at `/heartbeat` and keeps across `/clear` and `/resume`), no main-loop turn runs (the queue feature's `isBusy`), and another session in the home was active within the last interval (the newest write in the heartbeat's own transcript folder, `$.session.info().transcriptPath`'s, leaving out its own conversation and the one its last daily `/clear` left; a session that keeps no transcript can't tell, so it wakes). A wake looks even when five are showing, and swaps out weaker ones. The day's first wake runs `/clear` first. The interval is 55 minutes unless `/heartbeat <duration>` sets another, so a wake reads the prompt cache instead of rewriting it.

**Adding a proposal source**: a skill named `proposals-<topic>` whose description starts "Proposal source:", in a plugin or a home's `.claude/skills/`; the contract is `skills/proposals/references/sources.md`. For a few personal rules, a home's `extensions/skills/proposals.md` is enough. A mod command and a skill can't share a name in one plugin (the host refuses the command), which is why the wake's skill is `proposals` beside the `/heartbeat` command.

## The cmux sidebar

The optional cmux pack lives in `src/cmux/`. The Bun side (`entry.ts`, `file.ts`, `lifecycle.ts`, `command.ts`) builds this home's entry from the work model (`src/work/`) and writes it into `~/.config/cmux/sidebars/agentlayer.js`, the one sidebar every home on the Mac joins. The sidebar's own code in `src/cmux/sidebar/` runs inside cmux, not Bun: its `tsconfig.json` has no Bun or Node types, so a call to either fails the typecheck, and it never builds a path (every path and URL arrives ready-made in its data). Its Manager tab is [cmux Manager](https://github.com/AgentLayer1/cmux-custom-manager) (`cmux-custom-manager`, a devDependency bundled into `dist/`); the Agents tab is `sidebar/agent.ts`, which puts the agent chips (`agents.ts`, packed into lines by `lines.ts`) over the Projects (`projects.ts`), Reports (`reports.ts`), Recent (`recent.ts`, fed by `src/cmux/recent.ts` and kept fresh by `mods/sidebar/`) and Goals (`goals.ts`) sub-tabs. The Manager's INBOX (`messages.ts`) lists the proposals and notes of the selected workspace's agent, or every home's when no agent can be told; its buttons type `/message <choice> <id>` into that home's heartbeat tab, and a home without a heartbeat gets a card that starts one through `sidebar/session.ts`: a focused tab in the selected workspace, or a new workspace in the home when none is selected or the selected one is remote (cmux doesn't mark a tmux mirror, which refuses the tab). The Projects page opens on the tasks summary, the `<!-- SUMMARY:START -->` block sync writes into TASKS.md beside the goals (the heartbeat's wake rewrites it once it's six hours old, `writeDashboard` keeps it; `src/work/summary.ts` parses it into the work model). Every task row and goal carries a faint Discuss icon (no hover of its own: per-row hover made long lists lag) that opens the same way on `/<plugin>:discuss task:<id>` or `goal:<horizon>:<n>`, the slash-only `discuss` skill: a brief, a conversation, then a choice of next move, with nothing built first.

| Command | Does |
| --- | --- |
| `bun run cmux:build` | Bundle `src/cmux/sidebar/main.ts` into the committed `src/cmux/sidebar/dist/sidebar.js`. Run it after every sidebar change; a test fails while the file is stale |
| `bun run cmux:check` | Typecheck, rebuild, and run the pack's tests |
| `bun run cmux:preview --text` | Print what each page draws for the invented homes in `src/cmux/preview/fixture.ts` |
| `bun run cmux:preview` | Write `agentlayer-preview`, the sidebar drawing those homes with a frozen clock |
| `bun run cmux:screenshot` | Retake the screenshots: each page of the preview, cropped to the panel; `--window-demo` adds the whole window with made-up workspaces and groups; `--out <dir>` picks the folder |

The tests mount the built sidebar on cmux's own `SidebarRuntime.js`, read from the installed app and never copied into the repo (it is GPL-licensed), and assert what each page draws and which cmux call each tap makes. Without cmux installed they skip.

To retake the screenshots, from a terminal inside cmux (its CLI answers nowhere else):

```bash
bun run cmux:screenshot --window-demo --out <docs-repo>/public/assets/cmux
```

The preview draws `src/cmux/preview/showcase.ts`: three made-up agents (🐙 Oppi, 🦄 Nova, 🦀 Scout), each with its own workspace and three more for its kinds of work, Oppi's six projects in every state, reports across four days, and goals. The tests use the smaller `fixture.ts`, whose exact texts they assert. It opens a window of its own, sized 1400×900, and does everything there:
- each page (Manager, Projects, Reports, Goals) shot and cropped to the panel by `src/cmux/preview/png.ts`, which finds the panel's edge in the image itself, as `cmux-sidebar-<page>.png`;
- with `--window-demo`, made-up workspaces and two groups in that window's left sidebar and a mock chat in its terminal (`demo.ts`), then the whole window as `cmux-workstation.png`.

Every command names that window, except `workspace-group create`, which runs inside it. It closes the window at the end, so no other window, workspace or group is touched. `png.ts` and `window.ts` are copies of cmux-custom-manager's `preview/`, kept in step by hand.

## PR conventions

- Keep changes focused. One concept per PR.
- Update README if you change skill counts, tool counts, or external-facing flows.
- No new dependencies without justification.
- Run `bun run typecheck` and verify the MCP server still boots before opening.
- **No real names in shipped files.** Skills, templates, hooks, docs, tests, and the CHANGELOG use fictitious placeholders (`acme`, `Ada`), never a real client, employer, operator, or sibling project, and never at write time on the promise of a later sweep.
- **Product docs are host-neutral.** Anything describing agentlayer (docs, README, wizard copy) names skills bare, says "your host" for the CLI, and puts host-specific commands in per-host tabs, so a new host is a tab and a page, not a rewrite.
- **Generated HTML pages share their chrome.** The Auto / Light / Dark switch (`src/shared/theme.ts`) and, on any page that draws Mermaid into `.diagram` boxes, the expand-and-zoom viewer (`src/shared/diagram-viewer.ts`) are blocks carried verbatim in each template's `<head>`. A new template that draws diagrams joins `DIAGRAM_TEMPLATES` and runs `bun src/shared/diagram-viewer.ts sync`; the block's test fails until it does.
- **Frontmatter the plugin writes is flat:** scalars and lists of scalars only, since Obsidian shows anything nested as raw JSON. `report_write` rejects a nested `extra` value and the knowledge lint flags one; structured data goes in the body.
- **Frontmatter keys come from the host's docs.** Don't invent keys; `src/contracts/skills.test.ts` parses every `SKILL.md`, holds the description to 1,024 characters, and resolves relative links.
- **Invocability:** see *Adding a new skill* above; `src/contracts/skills.test.ts` holds the slash-only set to `discuss`, `init`, `proposals`, `release` and `rename-agent`.

## License

By contributing you agree your work is licensed under [Apache 2.0](./LICENSE).
