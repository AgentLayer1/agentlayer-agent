import { antigravityHost } from '@/hosts/antigravity';
import { claudeHost } from '@/hosts/claude';
import { codexHost } from '@/hosts/codex';
import { isHostName, type HostAdapter, type HostName } from '@/hosts/contract';

const BY_NAME: Record<HostName, HostAdapter> = { claude: claudeHost, codex: codexHost, antigravity: antigravityHost };

export const HOSTS: readonly HostAdapter[] = Object.values(BY_NAME);

/**
 * The host a hook verb serves when none is named.
 */
export const DEFAULT_HOST: HostAdapter = claudeHost;

export const hostNamed = (name: string): HostAdapter | undefined => (isHostName(name) ? BY_NAME[name] : undefined);
