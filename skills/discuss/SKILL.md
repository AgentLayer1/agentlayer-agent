---
name: discuss
description: Talk one task or goal through with the operator before anything is built - where it stands, what's unknown, the ways forward - then end on a choice of next move. Run by the sidebar's Discuss icon as discuss task:<id> or discuss goal:<day|week|month|year>:<n>.
disable-model-invocation: true
allowed-tools: mcp__plugin_agentlayer_agent__task_get, mcp__plugin_agentlayer_agent__task_query, mcp__plugin_agentlayer_agent__task_update, mcp__plugin_agentlayer_agent__task_create, mcp__plugin_agentlayer_agent__task_thread, AskUserQuestion, Read, Glob, Grep
---

# Discuss a task or goal

The operator tapped Discuss on a task or a goal. This session is for deciding, not building: work out together where it stands and what to do next, then let them pick the next move. Nothing changes until they do.

## 1. Find it

The argument names one thing:

- `task:<id>`: `task_get` it for its description, checklist and thread. Read its project's `projects/<slug>/README.md`, and `task_query` the project's other open tasks for what it sits beside or waits on. Open a file the task links to only when the brief needs it.
- `goal:<horizon>:<n>`: in `<HOME>/projects/TASKS.md`, between `<!-- GOALS:START -->` and `<!-- GOALS:END -->`, find the block for the horizon (`## Daily Goals`, `## Weekly Goals`, `## Monthly Goals` or `## Yearly Goals`) and take its n-th goal, counting the list items from 1 in the order they appear (the italic note lines are not goals). Note the project or tasks it names (`task_get` those) and the block's other goals.

If the argument is missing or names nothing, say what was asked for and what you found, and stop.

If session start listed `extensions/skills/discuss.md`, read it now: the operator's own rules for these conversations.

## 2. Brief

Open with a short brief, about 6 to 10 lines, in plain words:

- **Where it stands**: done, open or stuck; what the thread last says; who or what it waits on.
- **What's unknown**: the questions that decide the next step.
- **Ways forward**: two or three, each with what it costs (time, risk, what it closes off). Say which you'd pick and why, in one line.

End with "What's your take?"

## 3. Discuss

Answer their questions and read more when they point somewhere. Push back when you disagree. Make no edits, change no task, and run nothing with side effects: if they ask for a change mid-conversation, note it for the choice at the end.

## 4. Choose the next move

When the conversation settles (they agree, say "next", or ask what to do), ask once with AskUserQuestion: two to four concrete next moves, your recommendation first and marked. Draw them from the conversation, for example:

- plan it (plan mode, or the plan-spec skill for something large);
- break it into checklist steps or tasks (`task_update`, `task_create`);
- start on the first step now;
- park it, re-prioritize it, or change its due date (`task_update`);
- reword or drop the goal (the goals skill).

Act on the pick under the home's usual rules: plan before non-trivial building, and anything on the ask-first list still asks. Record what was decided in one `task_thread` line on the task (for a goal, on the task it names, if any).
