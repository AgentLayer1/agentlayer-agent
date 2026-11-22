import type { HostAdapter } from '@/hosts/contract';
import { pluginName } from '@/shared/naming';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const codexHost = {
  name: 'codex',
  launchDir: () => undefined,
  terminal: () => false,
  captureReply: 'json',
  guard: { cdCarries: false, powershellOn: (platform) => platform === 'win32' },
  floor: {
    version: '0.154.0',
    why: 'a running session refreshes plugin tools, skills, and hooks after an upgrade',
    update: 'npm install -g @openai/codex@latest'
  },
  skill: (name) => `$${name}`,
  usedBy: (home) => existsSync(resolve(home, '.codex', 'hooks.json')),
  homeIssues: () => [],
  billing: () => null,
  delivery: {
    kind: 'inject',
    glossary: {
      pluginRoot:
        "two folders above the loaded skill's SKILL.md (its `<skill>` block's `<path>`): the plugin copy that skill came from",
      skillDir: "the loaded skill's own folder, the one holding its SKILL.md",
      toolPrefix: `\`mcp__${pluginName()}__<tool>\`, the same tool on this host's ${pluginName()} MCP server`,
      askUser:
        "in Plan mode, `request_user_input`, which returns the answer as its result, so carry on; otherwise, and for a multi-select question, ask in chat (the question, then numbered options with the recommended one first), then end your turn and wait for the answer. Not `request_user_input_async`: Codex dismisses its card when your turn's final message renders",
      subagent:
        "this host's subagent tool if it offers one (`spawn_agent`); otherwise do each part yourself, one after another, to the same output contract",
      skill: '`$<name>`, the same skill run the way this host runs one',
      webSearch: "this host's web search, or the agent's `web_search` tool",
      webFetch: "this host's page fetch, or `curl`"
    }
  }
} satisfies HostAdapter;
