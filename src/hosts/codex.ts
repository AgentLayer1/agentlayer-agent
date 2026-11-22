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
  delivery: { kind: 'inject' }
} satisfies HostAdapter;
