import { claudeProtocol } from '@/hosts/claude-protocol';
import { staticContextFiles } from '@/config';
import { CLAUDE_CODE_ONLY, type HostAdapter } from '@/hosts/contract';
import { PLUGIN_SOURCE_ROOT, pluginName } from '@/shared/naming';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const codexHost = {
  name: 'codex',
  title: 'Codex',
  column: 'Codex',
  capabilities: {
    manual: { level: 'yes' },
    context: { level: 'yes' },
    capture: { level: 'yes' },
    guard: { level: 'yes' },
    rules: { level: 'yes' },
    tools: { level: 'yes' },
    skills: { level: 'partial', note: 'Codex runs its own copy, which lags the plugin until it is re-added' },
    setup: { level: 'yes' },
    ...CLAUDE_CODE_ONLY
  },
  setup: 'Start codex from this home and run $upgrade, which wires the home',
  machineIssues: () => [],
  ...claudeProtocol,
  launchDir: () => undefined,
  terminal: () => false,
  captureReply: 'json',
  recordsConversations: false,
  guard: { cdCarries: false, powershellOn: (platform) => platform === 'win32' },
  floor: {
    version: '0.154.0',
    why: 'a running session refreshes plugin tools, skills, and hooks after an upgrade',
    update: 'npm install -g @openai/codex@latest'
  },
  skill: (name) => `$${name}`,
  usedBy: (home) => existsSync(resolve(home, '.codex', 'hooks.json')),
  homeIssues: () => [],
  launchIssue: () => null,
  delivery: {
    kind: 'inject',
    files: staticContextFiles,
    glossaryIn: 'context',
    glossary: {
      pluginRoot: `in one of ${pluginName()}'s skills (its \`<path>\` runs through \`${pluginName()}/<version>/skills/\`), \`${PLUGIN_SOURCE_ROOT}\`, the checkout this session's hooks and MCP server run from, since that \`<path>\` is Codex's cached copy and can be an older version; in another plugin's skill, two folders above its SKILL.md`,
      skillDir: `in one of ${pluginName()}'s skills, \`${join(PLUGIN_SOURCE_ROOT, 'skills', '<skill>')}\` with the skill's name for \`<skill>\`; in another plugin's skill, the folder holding its SKILL.md`,
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
