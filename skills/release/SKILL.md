---
name: release
description: Producer-only. Cut a versioned release of the agentlayer plugin — analyze commits since the last release, detect what consumers must do to upgrade (bun install, settings, template/HOME changes), bump plugin.json, prepend a CHANGELOG entry with a machine-actionable Upgrade block, stage the commit + tag for approval, then offer to update the docs site to match. Use when the maintainer says "cut a release", "release agentlayer", "ship a new version", "bump the version and update the changelog". Not for consumers — they use /agentlayer:upgrade.
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit
---

> Operator-invoked only. Run this when the operator named this skill, or when a skill the operator invoked calls for it as a documented step; otherwise stop and ask before doing anything. Claude Code enforces this through the frontmatter above, Codex through `agents/openai.yaml`; this line is the backstop for any host that reads neither.

# Release — cut a versioned plugin release

> **Plugin root.** Claude Code fills in `CLAUDE_PLUGIN_ROOT`; Codex leaves it unset. Under Codex, read every `CLAUDE_PLUGIN_ROOT` path in this skill and its playbooks as this skill's base directory two levels up (the `<skill>` block's `<path>`).

Maintainer tool. Produces the **contract** that `/agentlayer:upgrade` consumes:
a bumped `plugin.json` version + a `CHANGELOG.md` entry whose `### Upgrade` block
tells every consumer exactly what their home needs after they `/plugin update`. Then it
offers to bring the docs site level with the release (Step 6).

Runs against the plugin repo at `${CLAUDE_PLUGIN_ROOT}`. **Never commits or tags without
explicit approval, and never pushes**: it stages everything and stops (per the standing
"one approval ≠ blanket commit license" rule), and the maintainer pushes after checking. Every command below names the repo
with `git -C "${CLAUDE_PLUGIN_ROOT}"` or an absolute path, so the session stays in the home
(the `guard` hook refuses a `cd` that would move it) and no git call lands in the home's own
repo. Shell variables don't survive between calls: where a block says `<range>`, write the
literal range from Step 0 (`<last tag>..HEAD`, or `HEAD` when there is no tag).

## Step 0 — Locate the plugin repo + last release

```bash
R="${CLAUDE_PLUGIN_ROOT}"
git -C "$R" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "not a git repo"; exit 1; }
CURRENT=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$R/.claude-plugin/plugin.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
LAST_TAG=$(git -C "$R" tag --list 'v*' --sort=-v:refname | head -1)
echo "current plugin.json version: $CURRENT"
echo "last tag: ${LAST_TAG:-<none>}"
git -C "$R" status --short
```

Determine the **last release point**, in order of preference:
1. the latest `v*` git tag (if any),
2. else the newest `## [x.y.z]` in `CHANGELOG.md`,
3. else the current `plugin.json` version (first-ever release).

If the working tree is dirty, decide with the maintainer whether those changes are
part of this release (usually yes) before proceeding.

## Step 1 — Gather changes since the last release

```bash
git -C "${CLAUDE_PLUGIN_ROOT}" log --oneline --no-merges <range>
git -C "${CLAUDE_PLUGIN_ROOT}" diff --stat <range>
```

Read the commit subjects + the changed-file list. Group the human-facing notes into
**Added / Changed / Fixed / Removed** for the CHANGELOG body. Keep them terse and
operator-readable (what changed, not commit-by-commit).

## Step 2 — Detect upgrade actions (what a consumer's home needs)

Diff the paths to derive the `### Upgrade` block. Check each:

**Dependencies** — did the MCP server's deps change?

```bash
git -C "${CLAUDE_PLUGIN_ROOT}" diff <range> -- package.json bun.lock | grep -E '^\+' | grep -v '^\+\+\+' || echo "(no dep changes)"
```

If any dependency was added/changed → `` `deps: required` `` naming the new packages.

**Templates** — did any scaffolded-file source change?

```bash
git -C "${CLAUDE_PLUGIN_ROOT}" diff --stat <range> -- templates/
```

For each changed `templates/<file>`, emit `` `template/<file>: <severity>` ``. Propose
severity, let the maintainer confirm/override:
- `templates/AGENTS.md`, `templates/CLAUDE.md` → **mandatory** (the operating manual and its
  Claude Code bridge are plugin-owned).
- `templates/SOUL.md`, `templates/IDENTITY.md` → **optional** (character files the
  operator personalizes) unless the change is functional, then mandatory.
  **Exception: a change confined to `IDENTITY.md`'s preamble or `## Who` reaches new
  homes only** — `/agentlayer:upgrade` never reconciles the persona block. If existing
  homes are meant to adopt it, it has to go in the release's `manual` notes; classifying
  it `optional` would silently ship it nowhere.
- new `templates/rules/<x>.md`, new `templates/knowledge/concepts/<x>.md` → **additive**
  (emit as `` `file: additive` `` with the HOME destination path).
  **Exception: a pack-gated rule is never additive.** `templates/rules/xcode.md` and
  `xcode-project.md` belong to the Xcode pack and are seeded by `configure-skills` §A.2f
  when the operator activates it, not by init and not by upgrade. Classifying one of them
  additive would push it into every home, including homes with no Xcode and no macOS — and
  `xcode.md` has no `paths:` frontmatter, so it would load unconditionally in every session
  there. Emit pack-gated rules as `` `manual: optional` `` naming the pack instead.
  `templates/repo/*.md` are repo scaffolds, never copied into a HOME: `none`.

**Settings** — do new MCP tools or skills need `permissions.allow` entries?

```bash
git -C "${CLAUDE_PLUGIN_ROOT}" diff <range> -- src/ | grep -E "name:\s*'[a-z_]+'" || true   # new defineTool names
git -C "${CLAUDE_PLUGIN_ROOT}" diff --stat <range> -- skills/                                                 # new skill dirs
```

A new always-on core tool, or a new model-invocable skill, needs a grant in consumer
`settings.json` → `` `settings: mandatory` `` naming the exact entries (e.g.
`mcp__plugin_agentlayer_agent__foo`, `Skill(agentlayer:foo)`). Match the canonical
list in `skills/init/SKILL.md`.

**Scripts** — did this release add a version-pinned migration script?

```bash
git -C "${CLAUDE_PLUGIN_ROOT}" diff --name-only --diff-filter=A <range> -- skills/upgrade/scripts/ || true
```

A new `skills/upgrade/scripts/<X.Y.Z>.ts` is a heavy one-time HOME migration. Emit
`` `script: required` `` (or `optional`) naming the version, e.g.
`` `script: required` — run skills/upgrade/scripts/1.2.0.ts (moves the reports folder). ``
The script's filename **must** equal the version you bump to in Step 3 — that's the
naming convention (filename = the release the migration is applied when upgrading to)
and how `/agentlayer:upgrade` finds it. So decide the bump (Step 3) and the filename
together: if you rename the bump, rename the script. A migration that relocates files or
strips settings is a **breaking** change — pre-1.0 that's a **minor** bump (`0.x` → `0.(x+1).0`),
post-1.0 a **major**; flag it in Step 3. Prefer a `script` over `manual` when the move
can be automated and verified.

**Manual** — anything a consumer must do by hand that *can't* be automated (an external
re-auth, a decision only they can make) → `` `manual: none` `` with clear instructions.
If a migration can be scripted, use `script`, not `manual`.

If none of the above apply, the Upgrade block is the single line:
`None — code-only, no bun install or HOME changes.`

## Step 3 — Decide the new version

**First, is the version already determined?** If Step 2 found a version-pinned migration
script (`skills/upgrade/scripts/<X.Y.Z>.ts`) added in the release range, the bump target
*is* that filename's `<X.Y.Z>` — the script ships in, and is applied when upgrading to,
exactly that release, and `/agentlayer:upgrade` resolves it by `<target>.ts`. The version
is **locked**; do **not** ask a three-way bump question. patch/major candidates aren't
valid here — picking one would leave the script named for a version you didn't release, so
upgrade would never run it. Instead:

- State the determined version (e.g. "migration script `1.2.0.ts` is in the range → this
  is the **v1.2.0** release") and proceed to Step 4 with it. A one-line confirm is fine; a
  bump menu is not.
- Sanity-check the magnitude against the rule below. A relocation/strip migration is
  breaking → pre-1.0 that's a **minor** (`0.x` → `0.(x+1).0`), post-1.0 a **major**. If the
  filename's implied bump and the actual change magnitude disagree, the **script is
  misnamed** — fix it by renaming the script to the correct target (and say so), never by
  choosing a version that contradicts the file.

**Otherwise (no migration script in the range)**, compute the three candidates from the
current `MAJOR.MINOR.PATCH` so the maintainer sees what each bump produces, then **ask**
with the `AskUserQuestion` tool — never pick the bump silently:

- **patch** → `MAJOR.MINOR.(PATCH+1)` — fixes only, no new surface.
- **minor** → `MAJOR.(MINOR+1).0` — new skills/tools/features, backward-compatible.
- **major** → `(MAJOR+1).0.0` — breaking changes to home layout, settings, or contracts.

Substitute the **real** current version into the option labels so each choice shows its
concrete target — e.g. if `plugin.json` is `0.2.2`, the options read `patch → 0.2.3`,
`minor → 0.3.0`, `major → 1.0.0`; if it's `0.4.7`, they read `0.4.8` / `0.5.0` / `1.0.0`.
Recommend the bump that matches the change magnitude from Steps 1–2 (put it first, label
it "(Recommended)"), but the maintainer's choice wins.

Then bump `version` in both manifests, `.claude-plugin/plugin.json` and
`.codex-plugin/plugin.json`, to the chosen (or determined) value (edit that one field in
each; `src/contracts/manifests.test.ts` fails when they drift). In the same pass, set the
setup guides' release line to the new tag: `RELEASE="vX.Y.Z"` in `install.sh` and
`$release = 'vX.Y.Z'` in `install.ps1`. Both front doors download their steps from that tag,
so a push to `main` never changes what a new user runs, and the same test fails when either
line lags the manifests.

> Note: `package.json` carries its own, separate `version` that is not used
> for plugin versioning and has drifted — leave it unless the maintainer asks to sync it.

## Step 4 — Write the CHANGELOG entry

Prepend a new entry **below** the `<!-- Add new releases below this line -->` marker in
`CHANGELOG.md`, newest first:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Upgrade
- `deps: required` — new dep `foo`; run bun install in the plugin root.
- `settings: mandatory` — add permission `Skill(agentlayer:foo)`.
- `template/AGENTS.md: mandatory` — new "X" section.
```

Use today's date (`date +%Y-%m-%d`). Omit empty Added/Changed/Fixed groups. The Upgrade
block must list **every** action from Step 2 (or the code-only sentinel). This is the
exact text `/agentlayer:upgrade` parses, so keep the backticked tags well-formed.

## Step 5 — Stage, show the diff, then ASK how far to go

The version + CHANGELOG edits are made, but **nothing in git has run yet**. Show the
maintainer the full diff to be committed:

```bash
git -C "${CLAUDE_PLUGIN_ROOT}" --no-pager diff -- .claude-plugin/plugin.json .codex-plugin/plugin.json CHANGELOG.md
git -C "${CLAUDE_PLUGIN_ROOT}" status --short
```

Then **ask** with the `AskUserQuestion` tool how far to take it — never commit or tag
without an explicit choice (per the standing "one approval ≠ blanket commit license"
rule). Offer exactly these options, and never a push:

- **Commit only** — `git commit`, no tag.
- **Commit + tag** — `git commit` then annotated `git tag vX.Y.Z`.

("Other" lets the maintainer abort or hand-tune.) Then run **only** the chosen subset:

```bash
git -C "${CLAUDE_PLUGIN_ROOT}" add .claude-plugin/plugin.json .codex-plugin/plugin.json CHANGELOG.md   # + any release-scoped files
git -C "${CLAUDE_PLUGIN_ROOT}" commit -m "Release vX.Y.Z"
git -C "${CLAUDE_PLUGIN_ROOT}" tag -a vX.Y.Z -m "vX.Y.Z"                   # commit+tag only
```

An untagged release commit can still take fixes before the tag: the maintainer tags the commit
they settle on. A pushed tag never moves. If `vX.Y.Z` already exists on the remote, leave it where it is:
never `git tag -f`, delete and re-create, or force-push a tag. Later commits ride into the next
release's range.

## Step 6 — Offer the docs pass

The plugin's docs live in the site repo, and they version with the plugin: a release that changes
what someone sees or does leaves pages describing the old behaviour unless they move with it. The
CHANGELOG entry is the start, not the scope. Run this after Step 5 whatever subset was chosen there;
skip it only when the maintainer aborted.

**Find the site checkout.** It sits beside the plugin checkout:

```bash
find "$(dirname "${CLAUDE_PLUGIN_ROOT}")" -maxdepth 6 -name node_modules -prune -o -path '*/content/docs/changelog.mdx' -print 2>/dev/null
```

Write the repo root (`git -C <hit's folder> rev-parse --show-toplevel`) literally as `<site>`
below; page paths are relative to the hit's `content/docs/` folder. Nothing found means this machine
has no site checkout: say so and go to Step 7. More than one (a worktree beside the main checkout):
ask which. Read the site's `AGENTS.md` before writing anything. Its docs rules (one home per fact,
host-neutral wording, one kind of page per page, version notes only in the changelog and the upgrade
notes, invented example names) and its commit rules bind every edit and commit below.

**Build the docs plan** from Step 1's commits and diff and the Step 4 entry. For each change someone
would notice, find every page it touches:

- **Always, the changelog page** (`changelog.mdx`): a `### X.Y.Z · Mon D [#vX-Y-Z]`
  section under its minor's `##` heading, one bolded highlight per line, each linking the page that
  explains it. Match the entries already there.
- **When the Upgrade block isn't the code-only sentinel, the upgrade notes**
  (`reference/upgrades.mdx` → Notes by version): what `upgrade` does on its own, what it
  asks first, and what is yours, linked from the changelog line.
- **A new, renamed or removed name** (skill, tool, CLI verb, hook, mod, setting, env var, home path,
  pack): grep the docs for the old and the new name, and update the reference page that lists it
  (`reference/skills`, `mcp-tools`, `cli`, `hooks`, `mods`, `agent-home`, `packs/`), exact counts
  included.
- **Changed behaviour:** the page that explains it. Grep for the skill, tool or file name and read
  each hit in full, not the matching line alone. A section that describes the old behaviour is
  rewritten to the new one, never footnoted.
- **Something new with no home:** a section in the closest page, or a new page with its folder's
  `meta.json` entry when it is a page of its own kind.
- **Something removed:** delete its section or page. A deleted or moved page gets a permanent
  redirect in the site's `next.config.mjs`, and links into it from this repo (the README, skills)
  are updated in the same pass.

Then check coverage: every line of the entry's Added, Changed and Fixed groups maps to at least one
row, or to a row saying `no page` with the reason. A maintainer-facing line counts too (a change to
this skill or to `upgrade` changes the pages that describe them).

Ask with the `AskUserQuestion` tool, with the plan as a table (page · add, change, remove or move ·
what · the commit behind it) in the first option's `preview`. The dialog may be all the maintainer
sees, so a table written before the question doesn't count, and the question names the page count.

- **Apply the whole plan** (Recommended)
- **Changelog and upgrade notes only**
- **Skip the docs**

**Write, regenerate, check.** Apply the chosen part, then regenerate the two files the site derives
from the plugin, every release (the demo shows the version), and never edit them by hand:

```bash
pnpm -C "<site>" --filter @agentlayer/agentlayer facts "${CLAUDE_PLUGIN_ROOT}"
bun "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/scripts/demo-home.ts" --out "<site>/apps/agentlayer/public/demo/dashboard.html" --avatar "<site>/apps/agentlayer/public/demo/assets/ace-avatar.jpg"
pnpm -C "<site>" --filter @agentlayer/agentlayer lint && pnpm -C "<site>" --filter @agentlayer/agentlayer exec tsc --noEmit
```

`lint` runs the docs lint too (links, redirects, sidebar `meta.json`). Read its verdict; a failure on
a page you touched is fixed, never added to the baseline.

Show `git -C "<site>" status --short` and the diff, then ask with the `AskUserQuestion` tool:
**Commit** or **Leave uncommitted**, never a push. Commits go on the branch the site is on and follow
the earlier releases' shape: `Document agentlayer X.Y.Z` (changelog, upgrade notes, reference pages),
one commit per sizeable feature-page change, and
`Generate the plugin facts and the demo dashboard from agentlayer X.Y.Z`. Deploying the site stays
with the maintainer.

## Step 7 — Hand off

Say where the plugin and the docs stand (committed, tagged, left uncommitted, or skipped) and that no
page was looked at rendered (the site's dev server runs in the maintainer's shell). Pushing is the
maintainer's, after they've checked: the plugin's branch and tag first, then the site, since pages
for a release nobody can install yet mislead.

Remind the maintainer of the consumer upgrade path so it can go in release notes:

```
/plugin marketplace update <marketplace>
/plugin update agentlayer@<marketplace>
# restart Claude Code, then:
/agentlayer:upgrade
```

And for a home run from Codex. The plugin installs into a version-pinned cache, so `upgrade`
regenerates the home's wiring and asks for a hook re-trust. `codex plugin marketplace upgrade`
refreshes Git marketplaces only, so a local checkout is re-added instead:

```
# from the agentlayer marketplace:
codex plugin marketplace upgrade agentlayer
codex plugin add agentlayer@agentlayer
# from a local checkout (agentlayer-dev), after git pull:
codex plugin remove agentlayer@agentlayer-dev
codex plugin add agentlayer@agentlayer-dev
# start a new Codex session from the home, then:
$upgrade
```

## Notes

- The dashboard's Changelog tab + the "upgrade available" badge read `CHANGELOG.md`
  and the consumer's `.state/version.json` automatically — no extra step here.
- Tags are the source of truth for "last release" once they exist; keep tagging every
  release so future `git log` ranges stay accurate.
- This skill is producer-only and slash-invoked. Consumers never run it.
