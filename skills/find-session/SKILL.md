---
name: find-session
description: Find a past session by what it worked on — a branch, a PR number, a worktree, a bug, a feature, a task id — and hand back its resume command or, from any host, its notes from the brain. Searches transcripts and session logs. Use when the operator asks "find the session that…", "which session was working on/with X", "give me the session that did X", "what session was I fixing X in", "search my sessions for X", or "resume the session about X". Complements the attention skill's checkpoint all (the recent-sessions radar) — reach for this when the operator names WHAT the session did rather than WHEN it ran.
allowed-tools: Bash, Read, AskUserQuestion
---

# find-session — locate a session by its content

The operator remembers the work, not the session id. This skill turns "the session that
was reworking the dashboard radar" into `claude --resume <id>`, or into its notes in
context when it can't be resumed from here. Notes are how a session carries across hosts: one
started in Claude Code continues in Codex or Antigravity, and the other way round. It searches
two places:

- **Claude Code's transcripts** (`~/.claude/projects/`): resumable, but filed under the
  folder a session started in, and kept only by that tool.
- **The brain's session logs** (`<home>/knowledge/raw/sessions/`): every captured session,
  whichever tool or folder it ran in, including sessions from before a home moved. Never
  pruned, so this is the history that lasts.

The deterministic work (search + signal extraction) lives in a bundled script; your job is
the discrimination: separating the session that *did* the work from the briefings, syncs,
and standups that merely *mentioned* it.

## Step 1 — derive search terms

Pull the most distinctive tokens from the ask. In rough order of power:

- **Branch / worktree slugs** (`alex/radar-recency`, `dark-mode`) — near-unique.
- **PR numbers** — search both spellings in one run: `#490` and `pull/490`.
- **Stable identifiers** — task ids (`ac-012`), error strings, ticket numbers.
- **Feature phrases** — a short distinctive phrase (`badge overflow`), not single
  common words (`dashboard` alone matches half the corpus).

Pass several variants in one invocation — terms OR together, and per-term counts come back
separately. If the operator's phrasing is vague, translate it into the artifact vocabulary
first (the branch, the PR, the file) using the memory already in context.

## Step 2 — run the search

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/find_session.ts" "<term>" "<term2>" ...
```

- **No time window by default** — the whole transcript history is searched. Add
  `--hours <n>` only when the operator anchors it in time ("last week's session").
- Scope semantics match the attention skill's checkpoint all: the script derives the default roots itself (the launch
  cwd, the agent HOME, and the code tree); `--scope` overrides with comma-separated roots,
  sessions launched in or beneath any of them. Zero matches → retry with `--scope all`
  before declaring it not found.
- Output is JSON sorted by raw hit count — **that sort is a starting point, not the
  answer** (Step 3). Two lists:
  - `sessions`: transcript hits in scope. Each carries `title` (operator's `/rename` wins
    over the auto-title), `started` / `last_timestamp`, `cwds` (every directory the session
    roamed into), `git_branches`, `first_user_msg`, `slash_commands`, `hits` per term,
    `terms_in_user_prompts` (which terms appear in the operator's own messages).
  - `brain`: session-log hits in this home, whatever the scope. Each carries `host` (the
    host it ran in: `claude`, `codex` or `antigravity`; null on old captures),
    `first_date` / `last_date`, `first_user_msg`, `slash_commands`, `hits`,
    `terms_in_user_prompts`, `transcript` (its `.jsonl` path anywhere on this machine, or
    null), and `blocks`: each captured entry as `file`, `start_line`, `end_line`, `date`,
    `turns` and its own `hits`.
  - The same session can appear in both; treat it as one candidate.

## Step 3 — rank by signal, not by hit count

**Given a session id** (or its first 8 characters), skip the ranking: the match whose
`session_id` starts with it is the answer, and every other hit only mentions it. Go
straight to Step 4.

Briefings, syncs, standups, and radar runs mention *everything* — they routinely out-hit
the session that did the work. Weigh, first match wins ties:

1. **Term in the operator's own prompts** (`terms_in_user_prompts` non-empty) — they asked
   for this work by name. The strongest single signal.
2. **Title describes the work** — especially a custom title (a `/rename` was deliberate).
3. **cwd roamed into a matching worktree** — a session whose `cwds` include
   `<repo>-<slug>` did hands-on work there; nothing else produces that trail.
4. **Hit concentration** — many hits in a session *not* explained by 1–3 usually means a
   reporting session. `slash_commands` names them (`/sync`, `/attention standup`, a briefing); a
   high-hit session that is just a skill run is a mention, not the work.

Brain hits have no title or cwd trail: lean on `terms_in_user_prompts`, `slash_commands`,
and the opening of the block with the most hits.

Traps, learned the hard way:

- **`git_branches` is the launch branch, not the work branch.** Sessions launch from the
  agent HOME on `main` and then roam; the branch the operator asked about shows up in
  worktree `cwds` and in content, almost never in `gitBranch`.
- **Commit SHAs and commit messages don't appear in transcripts** when the operator
  authors commits themselves — don't search for them.
- **File mtimes are unreliable** (bulk-touched by checkouts/backfills); the script's
  timestamps come from the transcript records, trust those.
- **One of the matches is this conversation** — the ask itself contains the terms.
  Recognize it and exclude it.

## Step 4 — verify, then deliver

Never hand back a resume command on ranking alone. For the top candidate, confirm against
`first_user_msg`, the timestamps, and the cwd trail that it actually is the work the
operator described; if that's not conclusive, read the transcript's tail
(`tail -c 80000 <file>`) before claiming. If two or more candidates genuinely survive
verification, put the choice to the operator via `AskUserQuestion` — label = title,
description = when it ran + what distinguishes it.

Where it ran and where you run decide the action. Only Claude Code's transcripts are resumable
here, and only from Claude Code; every other case continues through the session's notes.

- **You run in Claude Code, and its transcript is under the current folder:** hand back
  `claude --resume <id>`, as below.
- **You run in Claude Code, and its transcript is only under another folder** (a home that
  moved, a code repo): it resumes only from that folder (`cd <folder> && claude --resume <id>`),
  and an old home reopens on whatever plugin it had. Offer that, and offer loading its notes
  instead (next bullet).
- **Anything else** (you run in Codex or Antigravity, the session ran in one of them, or its
  transcript is gone): ask with `AskUserQuestion`, "Load this session's notes into context?",
  naming the host it ran in (`host`). On yes, read its `blocks` with `Read` (`offset` =
  `start_line`, `limit` = `end_line - start_line + 1`), the block with the most hits first,
  then offer the rest in date order rather than loading them all; a long session can fill the
  context. Then carry on its work here.
- **A Claude Code session that is still open,** found from another host: the brain holds it
  only up to its last compact, and not at all before one. Say where its notes stop; once the
  operator ends it in Claude Code, it is captured whole and this search finds the rest.

Deliver as a short card:

```
Found it: **<session-id>** — "<title>"

- **When:** <started> → <last_timestamp>
- **What it did:** <2–3 sentences: the original ask, the work done, how it ended>
- **Where it roamed:** <worktree/repo dirs, when load-bearing>

claude --resume <session-id>
```

(or, with nothing to resume here, the load offer in place of the command)

Then one honest line on the **boundary** of what the session contains — e.g. "ends at the
commit; the PR itself was opened elsewhere" — so the operator isn't surprised on resume.
Runners-up, if any, get a single line each (id + why they're plausible).

Ephemeral — no report, nothing written. Read-only with respect to sessions: never resume,
kill, or send input to one yourself, and never edit a session log.
