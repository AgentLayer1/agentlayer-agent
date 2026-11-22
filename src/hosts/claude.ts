import { FILES, SUBSCRIPTION_MARKER } from '@/config';
import type { HostAdapter } from '@/hosts/contract';
import { SKILL_PREFIX } from '@/hosts/dialect';
import { env } from '@/shared/env';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A home with its own Claude subscription file, in a session that didn't start with it, bills the default login.
 */
export const subscriptionIssue = (hasSubscription: boolean, marker: string | undefined): string | null =>
  hasSubscription && marker !== '1'
    ? 'started with "claude" instead of "agent", so it bills your default login. /exit, then run "agent".'
    : null;

export const claudeHost: HostAdapter = {
  name: 'claude',
  launchDir: () => env('CLAUDE_PROJECT_DIR'),
  delivery: { kind: 'import' },
  terminal: () => env('CLAUDE_CODE_ENTRYPOINT') === 'cli',
  captureReply: 'envelope',
  guard: { cdCarries: true, powershellOn: () => false },
  floor: {
    version: '2.1.314',
    why: "the shell guard also checks the Monitor tool's commands and the sandbox holds in a worktree resumed by `claude -p`, on top of a per-agent subscription token read from `--settings` (2.1.312 ignores it in a home's own settings), mods with `/done` autocomplete, Sonnet 5.5 behind the Haiku-tier remap, `bashEditDiffEnabled` and `claude plugin eval`",
    update: 'claude update'
  },
  usedBy: () => true,
  homeIssues: (home) =>
    existsSync(resolve(home, 'AGENTS.md')) && !existsSync(resolve(home, '.claude', 'CLAUDE.md'))
      ? [
          `\`.claude/CLAUDE.md\` is missing, so Claude Code loads neither the manual nor the identity stack — run \`${SKILL_PREFIX}upgrade\` to write the bridge`
        ]
      : [],
  billing: () => {
    const issue = subscriptionIssue(existsSync(FILES.CLAUDE_SUBSCRIPTION), env(SUBSCRIPTION_MARKER));
    return issue === null
      ? null
      : {
          banner: issue,
          section: `## ⚠️ Claude subscription\n\nThis agent has its own Claude subscription, but this session ${issue} If the operator did start with "agent", \`.state/secrets/.env.claude.json\` is missing \`"${SUBSCRIPTION_MARKER}": "1"\` in its \`env\`.\n\n**Report this to the operator before anything else**: every turn until they restart bills the wrong account.`
        };
  }
};
