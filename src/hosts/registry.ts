import { claudeHost } from '@/hosts/claude';
import { codexHost } from '@/hosts/codex';
import type { HostAdapter } from '@/hosts/contract';

export const HOSTS: readonly HostAdapter[] = [claudeHost, codexHost];

/**
 * The host a hook verb serves when none is named.
 */
export const DEFAULT_HOST: HostAdapter = claudeHost;

export const hostNamed = (name: string): HostAdapter | undefined => HOSTS.find((host) => host.name === name);
