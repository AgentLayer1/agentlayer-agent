import type { HostAdapter } from '@/hosts/contract';
import { SKILL_PREFIX } from '@/hosts/dialect';
import { env } from '@/shared/env';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
  billsSubscription: true
};
