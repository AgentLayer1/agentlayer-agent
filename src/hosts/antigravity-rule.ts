/**
 * The always-on rule the plugin ships for Antigravity: the glossary that reads the skills' Claude Code terms in
 * Antigravity's. A rule reaches every conversation, subagents included, which a session-start injection doesn't.
 *   bun src/hosts/antigravity-rule.ts sync   rewrites rules/antigravity.md from the adapter
 */
import { antigravityHost } from '@/hosts/antigravity';
import { renderGlossary } from '@/hosts/dialect';
import { PLUGIN_SOURCE_ROOT, pluginName } from '@/shared/naming';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const RULE_FILE = join(PLUGIN_SOURCE_ROOT, 'rules', 'antigravity.md');

export const renderRule = (): string =>
  [
    '---',
    'trigger: always_on',
    `description: How ${pluginName()}'s skills read in Antigravity`,
    '---',
    '',
    renderGlossary(antigravityHost.name, antigravityHost.delivery.glossary),
    ''
  ].join('\n');

if (import.meta.main && process.argv[2] === 'sync') {
  writeFileSync(RULE_FILE, renderRule());
}
