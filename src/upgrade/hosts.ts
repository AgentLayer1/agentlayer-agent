import type { HostFloor, HostName } from '@/hosts/contract';
import { HOSTS } from '@/hosts/registry';
import { compareSemver } from '@/upgrade/version';
import { execFileSync } from 'node:child_process';

export type ToolName = HostName | 'bun';
export type HostState = 'ok' | 'outdated' | 'absent';

interface ToolFloor extends HostFloor {
  name: ToolName;
}

const BUN_FLOOR: ToolFloor = {
  name: 'bun',
  version: '1.4.4',
  why: "YAML 1.2 parsing and Playwright's pipe transport on Windows (oven-sh/bun#11044, #27977)",
  update: 'bun upgrade'
};

export const HOST_FLOORS: readonly ToolFloor[] = [...HOSTS.map((host) => ({ name: host.name, ...host.floor })), BUN_FLOOR];

export interface HostStatus {
  name: ToolName;
  required: boolean;
  installed: string | null;
  floor: string;
  why: string;
  state: HostState;
  update: string;
}

export interface HostReport {
  ok: boolean;
  hosts: HostStatus[];
}

/** The first `x.y.z` in a `--version` line: `2.1.270 (Claude Code)`, `codex-cli 0.154.0`. */
export const parseHostVersion = (output: string): string | null => output.match(/\d+\.\d+\.\d+/)?.[0] ?? null;

export type VersionRunner = (name: ToolName) => string | null;

// TODO(windows): the npm shims are .cmd files, which execFile cannot start without a shell, so a Windows box reports both hosts absent.
const runVersion: VersionRunner = (name) => {
  if (name === 'bun') {
    return Bun.version;
  }
  try {
    return execFileSync(name, ['--version'], {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return null;
  }
};

/**
 * Every host the home is wired for or `also` names, then bun.
 */
export const requiredHosts = (home: string, also: readonly HostName[] = []): ReadonlySet<ToolName> =>
  new Set<ToolName>([
    ...HOSTS.filter((host) => host.usedBy(home) || also.includes(host.name)).map((host) => host.name),
    'bun'
  ]);

export const checkHosts = (required: ReadonlySet<ToolName>, run: VersionRunner = runVersion): HostReport => {
  const hosts = HOST_FLOORS.map((floor): HostStatus => {
    const output = run(floor.name);
    const installed = output === null ? null : parseHostVersion(output);
    const state: HostState =
      installed === null ? 'absent' : compareSemver(installed, floor.version) < 0 ? 'outdated' : 'ok';
    return {
      name: floor.name,
      required: required.has(floor.name),
      installed,
      floor: floor.version,
      why: floor.why,
      state,
      update: floor.update
    };
  });
  return { ok: hosts.every((host) => host.state === 'ok' || !host.required), hosts };
};

/** One line per host that needs the operator: outdated anywhere, absent where required. */
export const hostIssues = (report: HostReport): string[] =>
  report.hosts
    .filter((host) => host.state === 'outdated' || (host.state === 'absent' && host.required))
    .map((host) =>
      host.state === 'absent'
        ? `${host.name} is not on PATH, and this home is wired for it`
        : `${host.name} ${host.installed} is below the plugin's floor ${host.floor} (${host.why}) — run \`${host.update}\` and relaunch`
    );
