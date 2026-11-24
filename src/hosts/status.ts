import type { HostAdapter } from '@/hosts/contract';
import { SKILL_PREFIX } from '@/hosts/dialect';
import { HOSTS } from '@/hosts/registry';
import { isRecord } from '@/shared/json-block';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';
import { checkHosts, type HostStatus } from '@/upgrade/hosts';
import { resolve } from 'node:path';

export type Integration = 'ready' | 'needs-you' | 'not-set-up' | 'not-installed';

export interface Todo {
  text: string;
  commands: string[];
}

/** What the upgrade's registration check found, by host. */
export interface Registration {
  findings: { host: string; detail: string; commands: string[] }[];
  warnings: string[];
}

export interface HostFacts {
  host: HostAdapter;
  cli: HostStatus;
  wired: boolean;
  issues: string[];
}

export interface HostView {
  host: HostAdapter;
  cli: HostStatus;
  wired: boolean;
  state: Integration;
  todos: Todo[];
}

const binaryOf = (host: HostAdapter): string => host.floor.binary ?? host.name;

/** One host's state and what's left to do, from what was read about it. */
export const viewOf = ({ host, cli, wired, issues }: HostFacts, registration: Registration): HostView => {
  const cliTodos: Todo[] =
    cli.state === 'outdated'
      ? [
          {
            text: `${binaryOf(host)} ${cli.installed} is older than the ${cli.floor} the plugin needs`,
            commands: [cli.update]
          }
        ]
      : cli.state === 'absent' && wired
        ? [{ text: `${binaryOf(host)} isn't on your PATH, and this home is wired for it`, commands: [] }]
        : [];
  const todos = [
    ...cliTodos,
    ...registration.findings
      .filter((finding) => finding.host === host.name)
      .map(({ detail, commands }) => ({ text: detail, commands })),
    ...issues.map((text) => ({ text, commands: [] }))
  ];
  if (todos.length > 0) {
    return { host, cli, wired, state: 'needs-you', todos };
  }
  if (cli.state === 'absent' && !wired) {
    return { host, cli, wired, state: 'not-installed', todos };
  }
  return wired
    ? { host, cli, wired, state: 'ready', todos }
    : { host, cli, wired, state: 'not-set-up', todos: [{ text: host.setup, commands: [] }] };
};

const NO_REGISTRATION: Registration = { findings: [], warnings: [] };

const stringsIn = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The upgrade's registration check, run as the upgrade runs it, so both read one implementation. */
const readRegistration = (home: string): Registration => {
  const script = resolve(PLUGIN_SOURCE_ROOT, 'skills', 'upgrade', 'scripts', 'registration-check.ts');
  const run = Bun.spawnSync([process.execPath, script, '--home', home], { stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode !== 0) {
    return { ...NO_REGISTRATION, warnings: [`The registration check failed: ${run.stderr.toString().trim()}`] };
  }
  const parsed: unknown = JSON.parse(run.stdout.toString());
  if (!isRecord(parsed)) {
    return NO_REGISTRATION;
  }
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings.flatMap((finding: unknown) =>
        isRecord(finding) && typeof finding.host === 'string' && typeof finding.detail === 'string'
          ? [{ host: finding.host, detail: finding.detail, commands: stringsIn(finding.commands) }]
          : []
      )
    : [];
  // The home's Claude settings name a plugin id the upgrade renames itself.
  const renames = isRecord(parsed.settings)
    ? Object.values(parsed.settings).flatMap((flip: unknown) =>
        isRecord(flip) && typeof flip.from === 'string' && typeof flip.to === 'string'
          ? [
              {
                host: 'claude',
                detail: `The home's settings name ${flip.from}, which is now ${flip.to}; ${SKILL_PREFIX}upgrade renames it`,
                commands: []
              }
            ]
          : []
      )
    : [];
  return { findings: [...findings, ...renames], warnings: stringsIn(parsed.warnings) };
};

export interface HostsOverview {
  home: string | undefined;
  hosts: HostView[];
  warnings: string[];
}

/** Every host the plugin knows, read from this machine and, when there is one, the home. */
export const gatherHosts = (home: string | undefined): HostsOverview => {
  const report = checkHosts(new Set());
  const registration = home ? readRegistration(home) : NO_REGISTRATION;
  const hosts = HOSTS.map((host) => {
    const cli = report.hosts.find((status) => status.name === host.name);
    if (!cli) {
      throw new Error(`no version check for ${host.name}`);
    }
    const wired = home !== undefined && host.usedBy(home);
    const issues = wired && home ? [...host.homeIssues(home, host.skill), ...host.machineIssues()] : [];
    return viewOf({ host, cli, wired, issues }, registration);
  });
  return { home, hosts, warnings: registration.warnings };
};
