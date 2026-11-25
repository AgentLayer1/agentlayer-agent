import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listSecretEntries } from '@/config';
import { sidebarState } from '@/cmux/lifecycle';
import { CMUX_APP } from '@/cmux/app';
import { isRecord } from '@/shared/json-block';
import type { Probe } from './registry';

const readJson = (path: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const listOf = (settings: Record<string, unknown>[], key: 'allow' | 'deny'): Set<string> =>
  new Set(settings.flatMap((layer) => strings(isRecord(layer.permissions) ? layer.permissions[key] : undefined)));

const envOf = (settings: Record<string, unknown>[]): Record<string, string> =>
  Object.fromEntries(
    settings.flatMap((layer) =>
      isRecord(layer.env)
        ? Object.entries(layer.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string')
        : []
    )
  );

const entries = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);

const financeEntities = (home: string): Probe['finances'] => {
  const dir = join(home, 'projects', 'finances', 'entities');
  return entries(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const text = readFileSync(join(dir, name), 'utf8');
      const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
      const accounts = /^## Accounts\s*\n[\s\S]*?\bid:/m.test(text);
      return { slug: name.slice(0, -3), company: /^kind:\s*company\s*$/m.test(front), accounts };
    });
};

/** Everything the pack detectors read, from this home's settings, files and secret store. */
export const readProbe = (home: string): Probe => {
  const settings = ['settings.json', 'settings.local.json'].map((file) => readJson(join(home, '.claude', file)));
  const mcp = readJson(join(home, '.mcp.json'));
  const skills = join(home, '.claude', 'skills');
  const macos = process.platform === 'darwin';
  return {
    allow: listOf(settings, 'allow'),
    deny: listOf(settings, 'deny'),
    env: envOf(settings),
    secrets: new Set(listSecretEntries().flatMap((entry) => (entry.present ? [entry.name] : []))),
    mcpServers: isRecord(mcp.mcpServers) ? Object.keys(mcp.mcpServers) : [],
    exists: (path) => existsSync(join(home, path)),
    libraries: entries(skills).filter((name) => lstatSync(join(skills, name)).isSymbolicLink()).length,
    cmux: macos ? sidebarState(home) : 'not-installed',
    finances: financeEntities(home),
    macos,
    cmuxApp: macos && existsSync(CMUX_APP)
  };
};
