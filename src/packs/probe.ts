import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CMUX_APP } from '@/cmux/app';
import { sidebarJoined } from '@/cmux/lifecycle';
import { listSecretEntries } from '@/config';
import { connectors } from '@/helpdesk/connectors';
import { readMergedSettings, readSettingsFile } from '@/home/settings-scope';
import { antigravityHost } from '@/hosts/antigravity';
import { codexHost } from '@/hosts/codex';
import { dbConnections, env, GITHUB_TOKEN_KEY, githubTokenKeys } from '@/shared/env';
import { isRecord, stringsOf } from '@/shared/json-block';
import { listMarkdown, readText } from '@/shared/text';
import { runVersion } from '@/upgrade/hosts';
import type { Probe } from './registry';

// The finances skill's own rules (skills/finances/scripts/calendar.ts parseEntity): an entity is a
// company unless its frontmatter says individual, and its accounts are the yaml block under ## Accounts.
const ACCOUNTS = /^## Accounts[ \t]*\n(?:(?!^## )[\s\S])*?^```ya?ml\n(?:(?!^```)[\s\S])*?\bid:/m;

const financeEntities = (home: string): Probe['finances'] => {
  const dir = join(home, 'projects', 'finances', 'entities');
  return listMarkdown(dir).map((name) => {
    const text = readText(join(dir, name));
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    return {
      slug: name.slice(0, -3),
      company: !/^kind:\s*individual\s*$/m.test(front),
      accounts: ACCOUNTS.test(text)
    };
  });
};

/** Everything the pack detectors read, from this home's settings (both layers, as Claude Code merges them), files and secret store. */
export const readProbe = (home: string): Probe => {
  const { merged } = readMergedSettings(home);
  const permissions = isRecord(merged.permissions) ? merged.permissions : {};
  const servers = readSettingsFile(join(home, '.mcp.json')).mcpServers;
  const skills = join(home, '.claude', 'skills');
  const present = new Set(listSecretEntries().flatMap((entry) => (entry.present ? [entry.name] : [])));
  const macos = process.platform === 'darwin';
  return {
    allow: new Set(stringsOf(permissions.allow)),
    deny: new Set(stringsOf(permissions.deny)),
    env: isRecord(merged.env)
      ? Object.fromEntries(
          Object.entries(merged.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string')
        )
      : {},
    key: (name) => env(name) !== undefined,
    signedIn: new Set((['google', 'slack'] as const).filter((service) => present.has(`${service}/tokens`))),
    connections: {
      github: githubTokenKeys().length + (env(GITHUB_TOKEN_KEY) === undefined ? 0 : 1),
      database: dbConnections().length,
      helpdesk: connectors().length
    },
    mcpServers: isRecord(servers) ? Object.keys(servers) : [],
    exists: (path) => existsSync(join(home, path)),
    libraries:
      existsSync(skills) &&
      readdirSync(skills, { withFileTypes: true }).some(
        (entry) => !entry.name.startsWith('.') && entry.isSymbolicLink()
      ),
    cmuxJoined: macos && sidebarJoined(home),
    finances: financeEntities(home),
    macos,
    cmuxApp: macos && existsSync(CMUX_APP),
    inCmux: env('CMUX_WORKSPACE_ID') !== undefined,
    hosts: {
      codex: { installed: runVersion('codex') !== null, wired: codexHost.usedBy(home) },
      antigravity: { installed: runVersion('antigravity') !== null, wired: antigravityHost.usedBy() }
    }
  };
};
