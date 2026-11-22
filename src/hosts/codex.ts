import { FOLDERS, PLUGIN_NAME } from '@/config';
import type { HostAdapter } from '@/hosts/contract';
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
  usedBy: (home) => existsSync(resolve(home, '.codex', 'hooks.json')),
  homeIssues: () => [],
  billsSubscription: false,
  delivery: {
    kind: 'inject',
    glossary: {
      pluginRoot: `the plugin root, \`${FOLDERS.ROOT}\``,
      toolPrefix: `\`mcp__${PLUGIN_NAME}__<tool>\`, the same tool on this host's ${PLUGIN_NAME} MCP server`,
      askUser:
        'no such tool here: ask in chat (the question, then numbered options with the recommended one first), then stop and wait for the answer',
      subagent:
        "this host's own subagent if it has one; otherwise do each part yourself, one after another, to the same output contract",
      skill: '`$<name>`, the same skill run the way this host runs one',
      webSearch: "this host's web search, or the agent's `web_search` tool",
      webFetch: "this host's page fetch, or `curl`"
    },
    skillPrefix: '$'
  }
} satisfies HostAdapter;
