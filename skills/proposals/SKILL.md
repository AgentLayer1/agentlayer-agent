---
name: proposals
description: The heartbeat's wake, run by its own clock in the session /heartbeat chose (or with /heartbeat now) - look at tasks, sync, GitHub and every proposal source skill, then top Proposals back up to five. Proposes only; never starts, sends or edits anything.
disable-model-invocation: true
allowed-tools: mcp__plugin_agentlayer_agent__proposal_add, mcp__plugin_agentlayer_agent__task_query, mcp__plugin_agentlayer_agent__task_get, mcp__plugin_agentlayer_agent__compile_status, mcp__plugin_agentlayer_agent__github_sweep, Skill, Read, Edit, Bash
---

# Heartbeat: keep Proposals full

Proposals are sessions waiting for the operator's yes: Start opens a fresh session that runs the proposal's prompt, Later brings it back in the morning, Skip drops it. This skill runs on the heartbeat's wake. Its one job is to bring the waiting proposals back to five, then stop. It never starts, sends or edits anything itself.

## 1. See what's there

First, the tasks summary in `<HOME>/projects/TASKS.md`, between `<!-- SUMMARY:START -->` and `<!-- SUMMARY:END -->`. When it holds only its placeholder, or its `_Written <YYYY-MM-DD HH:MM> by …_` line is more than six hours old (compare with `date '+%Y-%m-%d %H:%M'`), rewrite what sits between the markers with Edit. Write the heading `## Tasks at a Glance`, the line `_Written <now> by the heartbeat_`, and two or three sentences on what the open and active tasks add up to across projects: what the work is about, where the weight sits, what is stuck or waiting. Use no task ids or lists. Change nothing outside the markers. Then:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" proposals list
```

It prints how many are showing out of five and the room for new ones. With no room, say "Proposals full, nothing new" and stop. If session start listed `extensions/skills/proposals.md`, read it now: the operator's own rules for what to propose, and they win where they disagree with this file.

## 2. Gather candidates

Look in this order, and stop looking once you hold a few more candidates than the room:

1. **Tasks** (`task_query`): overdue and due-this-week P0/P1 tasks first, then the next unchecked step of an active P1 task (`task_get` for its checklist). Source key `task:<id>`.
2. **The brain**: a sync last run three or more days ago, or a compile backlog (`compile_status`). Source key `sync` or `compile`.
3. **GitHub**, only where the GitHub pack is set up: what waits on the operator (`github_sweep`): a review asked of them, a comment on their PR, red CI on their branch. Source key `gh:<owner>/<repo>#<n>`.
4. **Proposal sources**: every skill in this session whose name starts `proposals-` and whose description starts "Proposal source:", from this plugin, another plugin or the home. Run each with the Skill tool; each returns candidates and adds nothing. The contract they follow is in [references/sources.md](references/sources.md).

## 3. Propose the best few

Pick the candidates worth the operator's yes, most pressing first, up to the room, and add them in one `proposal_add` call. It refuses a source already waiting, started in the last day or skipped in the last week; for each refusal, add the next-best candidate you hold in another call, until the room is used or your candidates run out. Each one is a session a stranger could run:

- **title**: what the session does, as an imperative, under 60 characters ("Draft the reply to your accountant").
- **trigger**: what happened, in the operator's terms ("Your accountant wrote two hours ago").
- **detail**: one or two sentences: what the session will do and where it stops.
- **estimate**: how long the session should take: `5m`, `15m`, `1h`.
- **reach**: what it may touch. Drafts only: never send, post, pay, merge or delete, and nothing on the home's ask-first list.
- **prompt**: the whole first message for a fresh session with none of this context: the task or issue id, what to do, the reach again, and the stop point ("…then stop and show me the draft").
- **source**: the key from step 2; a refusal for it is expected, not an error.

Propose nothing rather than filler: a quiet hour is a good hour.

## 4. End

One line, nothing else: "Proposed 2: Draft the reply to your accountant; Run the sync." or "Nothing new worth proposing."
