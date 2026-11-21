# Proposal sources

A proposal source lets a plugin, or the operator's own home, add what the heartbeat looks at without changing this plugin. It is an ordinary skill with two marks:

- its **name** starts `proposals-` (`proposals-support`, `proposals-family`);
- its **description** starts "Proposal source:" and says in a line what it watches.

Where it lives decides who has it: in a plugin's `skills/` for everyone who installs that plugin, or in a home's `.claude/skills/` for that home alone. For a few personal rules, a source is more than needed: `extensions/skills/proposals.md` in the home changes this skill directly.

## What a source does

The heartbeat runs every source it can see, once per wake, with the Skill tool. A source:

1. Looks with its own tools: its plugin's MCP tools, the CLI, files it owns.
2. **Returns candidates; never calls `proposal_add`.** The heartbeat weighs all candidates together and keeps the best five showing, retiring cards a stronger candidate beats.
3. Returns **at most three**, most pressing first, each in `proposal_add`'s shape: `source`, `title`, `trigger`, `detail`, `reach`, `estimate`, `prompt`, and `quote` and `due` when they help.
4. Prefixes each `source` key with its own name, so two sources can't collide: `support:ticket-412`, `family:school-form`.
5. Writes nothing, sends nothing, and proposes only drafts: the prompt it writes runs later, in a fresh session, after the operator says yes.

A source with nothing to say returns nothing, and quickly: it runs on every wake.

## A source, start to finish

```markdown
---
name: proposals-support
description: Proposal source: tickets waiting on the operator for more than a day in the support queue.
allowed-tools: mcp__plugin_acme_support__tickets
---

# Proposal source: support

List open tickets assigned to the operator (`tickets` with `status=open`). For each waiting more than a day,
oldest first, at most three, return a candidate:

- source: `support:ticket-<id>`
- title: "Draft a reply to ticket <id>"
- trigger: "<customer> has waited <n> days"
- detail: "Reads the thread and drafts a private-note reply. Sends nothing."
- reach: "Drafts a private note only."
- estimate: "10m"
- prompt: "Open support ticket <id> with the tickets tool, read the whole thread, and draft a reply as a private
  note. Do not send it. Stop and show me the draft."

Return the list and nothing else.
```
