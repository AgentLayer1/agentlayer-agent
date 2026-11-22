---
name: proposals
description: The heartbeat's wake, run by its own clock in the session /heartbeat chose (or with /heartbeat now) - look at tasks, the brain, GitHub, live sessions and every proposal source skill, then keep the best five in Proposals, retiring cards a better one outranks. Proposes only; never starts, sends or edits anything.
disable-model-invocation: true
allowed-tools: mcp__plugin_agentlayer_agent__proposal_add, mcp__plugin_agentlayer_agent__task_query, mcp__plugin_agentlayer_agent__task_get, mcp__plugin_agentlayer_agent__compile_status, mcp__plugin_agentlayer_agent__github_sweep, Skill, Read, Edit, Bash
---

# Heartbeat: keep Proposals full

Proposals are sessions waiting for the operator's yes: Start opens a fresh session that runs the proposal's prompt, Later brings it back in the morning, Dismiss drops it. This skill runs on the heartbeat's wake. Its one job is to leave the five best proposals showing, then stop: it fills empty places and swaps out cards a stronger candidate beats, so the list stays strong even when it was already full. It never starts, sends or edits anything itself.

## 1. See what's there

First, the tasks summary in `<HOME>/projects/TASKS.md`. When it holds only its placeholder, or its written line is more than six hours old (compare with `date '+%Y-%m-%d %H:%M %z'`), rewrite it `by the heartbeat`, as [the sync skill's tasks-summary reference](../sync/references/tasks-summary.md) describes. Then:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/src/cli.ts" proposals list
```

It prints the five (or fewer) showing, with their ids, and the room left. A full list is not a reason to stop: every showing card is weighed again below. When this skill was run with `workspaces: ["A", "B", …]` (a JSON list), those are the titles of the cmux workspaces open now, across every agent on the machine; keep them for step 4. If session start listed `extensions/skills/proposals.md`, read it now (with none listed the home has none: don't look for the folder): the operator's own rules for what to propose, and they win where they disagree with this file.

## 2. Gather candidates

Every look gathers, whether or not five are showing and however recently the last look ran: this session starts each wake with no memory of the last one, so a look that only re-checks the showing cards hasn't looked. Look in this order, and stop looking once you hold a few strong candidates beyond the room:

1. **Tasks** (`task_query`): overdue and due-this-week P0/P1 tasks first, then the next unchecked step of an active P1 task (`task_get` for its checklist). Source key `task:<id>`.
2. **The brain**: a full sync last run three or more days ago (its interviews, goals and briefings wait for the operator; the heartbeat's own brain refresh doesn't replace them), source key `sync`. When a brain refresh ran earlier in this conversation, each stalled task its flywheel listed is a candidate too ("Decide on <task>, stalled N days"), source key `stalled:<id>`.
3. **GitHub**, only where the GitHub pack is set up: what waits on the operator (`github_sweep`): a review asked of them, a comment on their PR, red CI on their branch. Source key `gh:<owner>/<repo>#<n>`.
4. **Proposal sources**: every skill in this session whose name starts `proposals-` and whose description starts "Proposal source:", from this plugin, another plugin or the home. Run each with the Skill tool; each returns candidates and adds nothing. The contract they follow is in [references/sources.md](references/sources.md).

## 3. Leave out what a session already has

A proposal for work the operator is already doing is noise. List the sessions active in the last six hours, one line each (id · age · branch · what it is about · its latest ask), and run it once as written:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/skills/attention/scripts/list_sessions.ts" --hours 6 --brief
```

Skip the heartbeat's own sessions: any whose topic or latest ask is `/heartbeat`, `/clear`, `/agentlayer:proposals` or `/agentlayer:sync brain`. Drop any candidate, and mark for retiring any showing card, that a listed session is working on: the same task id, issue or PR number, branch, or plainly the same piece of work by its title and recent messages. When unsure whether a session covers it, keep it: a duplicate costs the operator one Skip.

## 4. Keep the best five

Rank the showing cards and the candidates together, most pressing first: overdue or due today, someone waiting on the operator, then what unblocks the most. The top five should show. In one `proposal_add` call, add the candidates that made it and `retire` each showing card that didn't, or that step 3 marked, or that is no longer true (its task closed, its PR merged), each with a short reason. A card retired only to make way for a new one names that one's source in `for`, so it stays if the new one is refused. Never retire a card to make room for filler: a card only goes for a clearly stronger candidate or because it no longer holds. A card put off with Later isn't showing and is left alone.

`proposal_add` refuses a source already waiting, started in the last day or dismissed in the last week; for each refusal, add the next-best candidate you hold in another call, until five show or your candidates run out. Each new proposal is a session a stranger could run:

- **title**: what the session does, as an imperative, under 60 characters ("Draft the reply to your accountant").
- **trigger**: what happened, in the operator's terms ("Your accountant wrote two hours ago").
- **detail**: one or two sentences: what the session will do and where it stops.
- **estimate**: how long the session should take: `5m`, `15m`, `1h`.
- **reach**: what it may touch. Drafts only: never send, post, pay, merge or delete, and nothing on the home's ask-first list.
- **prompt**: the whole first message for a fresh session with none of this context: the task or issue id, what to do, the reach again, and the stop point ("…then stop and show me the draft").
- **source**: the key from step 2; a refusal for it is expected, not an error.
- **folder**: where the work happens: the repo's path for code work, else the home.
- **workspace**: from the `workspaces:` titles, the one this session belongs in by the kind of work (a PR review in a reviews workspace, an investigation in an investigations one); empty when none fits or none were given. The titles span every agent: never pick a workspace named for another agent (`Agent <Name>`), and leave it empty rather than guess. The sidebar checks the pick against this agent's own workspaces when Start is pressed.

Propose nothing rather than filler: a quiet hour is a good hour.

## 5. End

Exactly one short line, with no second sentence and nothing after it, since it is what the heartbeat's band shows: "Proposed 2, retired 1: Draft the reply to your accountant; Run the sync." or "Nothing new worth proposing." Say nothing about the tasks summary; the heartbeat refreshes the dashboard and sidebar itself once this turn ends.
