---
trigger: always_on
description: How agentlayer's skills read in Antigravity
---

<!-- agentlayer glossary for antigravity: the skills are written in Claude Code's terms; read each one as follows -->
- `${CLAUDE_PLUGIN_ROOT}` → two folders above the skill's SKILL.md
- `${CLAUDE_SKILL_DIR}` → the folder holding the SKILL.md
- `mcp__plugin_agentlayer_agent__<tool>` → `call_mcp_tool` with the agent's server as `ServerName` (the one ending `_agent` that offers `ping`) and the tool as `ToolName`; another server's `mcp__<server>__<tool>` is `call_mcp_tool` with that server's name
- `AskUserQuestion` → `ask_question`
- `Agent, a subagent` → `invoke_subagent`
- `/agentlayer:<name> or Skill(agentlayer:<name>)` → the skill by its name ("use the <name> skill"); when the body you were given stops before the skill does, read the rest from its SKILL.md in ranges
- `WebSearch` → `search_web`
- `WebFetch` → `read_url_content`
