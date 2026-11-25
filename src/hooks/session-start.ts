/**
 * Three disjoint paths:
 *  - **Pre-init**: nothing scaffolded here — emit the banner + setup hint. NO
 *    filesystem writes (anything that CREATES under FOLDERS.* must stay out of
 *    this path, or an empty home tree appears before the user picks a home;
 *    reading a resolved path is fine).
 *  - **Stranded**: a `SOUL.md` but no data dir — another agent's home, or this
 *    one's marker lost in a restore. Explain, and steer away from init.
 *  - **Post-init**: assemble the dynamic lane (today, last session tail, today's
 *    and pinned reports, git activity).
 *
 * Always returns a result — internal errors are caught and emitted as an
 * empty payload + `error` field so the host never chokes on hook output.
 */
import { AGENT_SLUG, FILES, FOLDERS, isInitialized, PLUGIN_NAME } from '@/config';
import { assembleContext } from '@/hooks/context';
import type { HostAdapter, SkillCommand } from '@/hosts/contract';
import { renderGlossary } from '@/hosts/dialect';
import { DEFAULT_HOST } from '@/hosts/registry';
import { drainDeferredCaptures, drainOpenConversations } from '@/knowledge/session-capture';
import { BANNER, BANNER_LINES, BANNER_TAG } from '@/hooks/banner';
import { stripAnsi } from '@/shared/ansi';
import { log as baseLog } from '@/shared/log';
import { RUNTIME_DIR } from '@/shared/naming';
import { readText } from '@/shared/text';
import { existsSync } from 'node:fs';
import { relative, sep } from 'node:path';

const log = baseLog.session.with('start');

export interface SessionStartResult {
  systemMessage: string;
  additionalContext: string;
  hasIssues?: boolean;
  error?: string;
}

const preInitResult = (skill: SkillCommand): SessionStartResult => ({
  systemMessage: ['', BANNER, '', `→ Not set up yet, run ${skill('init')} to get started.`].join('\n'),
  additionalContext: [
    `The ${PLUGIN_NAME} plugin is loaded, but \`${skill('init')}\` hasn't been run yet — the Agent home directory and identity files don't exist.`,
    '',
    `If the user asks you to do anything that requires the agent's data (compile, briefing, task ops, knowledge lookup), suggest they run \`${skill('init')}\` first.`,
    '',
    "If they ask general questions or want help with something unrelated to the agent, answer normally — you don't need the agent's context to be helpful."
  ].join('\n'),
  hasIssues: false
});

/**
 * `SOUL.md` present, this agent's data dir absent. Two causes, and the operator
 * has to pick: a restore or clone that dropped `<data-dir>/`, or a session
 * launched in a *different* agent's home. Never suggest init here — it would
 * offer to overwrite the identity files that are sitting right there.
 */
const strandedHomeResult = (): SessionStartResult => {
  return {
    systemMessage: [
      '',
      BANNER,
      '',
      `→ ${FOLDERS.HOME} has a SOUL.md but no ${RUNTIME_DIR}/version.json recording this agent — see the note below. Do NOT run init.`
    ].join('\n'),
    additionalContext: [
      `The ${PLUGIN_NAME} plugin is loaded and \`${FOLDERS.HOME}\` looks like an agent home (it has a SOUL.md), but no \`${RUNTIME_DIR}/version.json\` records \`${PLUGIN_NAME}\`, which is how this agent recognises its own home. Until that's resolved the agent's data is unreachable: sessions won't be captured and its tools will refuse to run.`,
      '',
      'Help the user work out which cause applies:',
      '',
      `1. **This is another agent's home.** Every agent's home has a SOUL.md, only this one's \`${RUNTIME_DIR}/version.json\` records \`${PLUGIN_NAME}\`. Launch that agent from here instead, and launch this one from its own home.`,
      `2. **This home's \`${RUNTIME_DIR}/\` state didn't survive a restore, clone, or sync.** Restore \`${RUNTIME_DIR}/version.json\` (upgrade baseline, the file that marks the home) and \`${RUNTIME_DIR}/knowledge.json\` (compile cursor) from the backup or the brain repo; both are git-tracked. Without the compile cursor the next compile re-ingests everything.`,
      '',
      '**Do not suggest `init` to fix this.** Its re-run path offers to overwrite SOUL.md, IDENTITY.md, USER.md and the operating manual, which is the operator losing their agent, not repairing it.'
    ].join('\n'),
    hasIssues: true
  };
};

// A terminal that can't render ANSI prints the escapes as raw bytes (Codex's ratatui does).
const PLAIN_BANNER = [...BANNER_LINES, BANNER_TAG].join('\n');

/**
 * `promptRow` when a prompt row draws nudges and alerts; `color` only where the host's terminal renders ANSI.
 */
export async function sessionStart({
  host = DEFAULT_HOST,
  promptRow = false,
  color = false
}: { host?: HostAdapter; promptRow?: boolean; color?: boolean } = {}): Promise<SessionStartResult> {
  const inject = host.delivery.kind === 'inject' ? host.delivery : undefined;
  const glossary = inject?.glossaryIn === 'context' ? [renderGlossary(host.name, inject.glossary)] : [];
  try {
    if (!isInitialized()) {
      // A SOUL.md with no data dir isn't a fresh directory — it's a scaffolded
      // brain whose marker is missing, or another agent's home. Telling either
      // one to run init is wrong, and destructive for the first: init offers to
      // overwrite exactly the identity files that are sitting right there.
      const stranded = existsSync(FILES.SOUL);
      if (stranded) {
        log.warn(`hook fired (home marker missing at ${FOLDERS.HOME})`);
      } else {
        log.info('hook fired (pre-init)');
      }
      const result = stranded ? strandedHomeResult() : preInitResult(host.skill);
      return {
        ...result,
        systemMessage: color ? result.systemMessage : result.systemMessage.replace(BANNER, PLAIN_BANNER),
        additionalContext: [...glossary, result.additionalContext].join('\n\n')
      };
    }
    await drainDeferredCaptures().catch((err: unknown) => log.error('deferred captures not drained', err));
    await drainOpenConversations().catch((err: unknown) => log.error('open conversations not drained', err));
    const lane = await assembleContext({ promptRow, host }).catch((err: unknown) => {
      log.error(`hook failed (${host.name}): dynamic lane skipped`, err);
      const message = err instanceof Error ? err.message : String(err);
      return {
        context: `<!-- ${AGENT_SLUG}: dynamic session context unavailable: ${message} -->`,
        banner: `⚠ dynamic session context unavailable: ${message}`,
        hasIssues: true
      };
    });
    // Mirror what the operator sees into the log file so context-assembly
    // issues (missing knowledge dir, git unavailable, oversized payload) are
    // diagnosable after the fact.
    (lane.hasIssues ? log.warn.bind(log) : log.info.bind(log))(`hook fired (${host.name})\n` + stripAnsi(lane.banner));
    const banner = color ? lane.banner : stripAnsi(lane.banner);
    if (!inject) {
      return { systemMessage: '\n' + banner, additionalContext: lane.context, hasIssues: lane.hasIssues };
    }
    const files = inject
      .files()
      .filter((path) => existsSync(path))
      .map((path) => {
        const name = relative(FOLDERS.HOME, path).split(sep).join('/');
        try {
          return `<!-- file: ${name} -->\n${readText(path).trimEnd()}`;
        } catch (err) {
          log.error(`hook failed (${host.name}): ${name} unreadable`, err);
          return `<!-- ${AGENT_SLUG}: ${name} unreadable: ${err instanceof Error ? err.message : String(err)} -->`;
        }
      });
    const additionalContext =
      [
        `<!-- ${AGENT_SLUG} static context · harness: ${host.name} · hooks and MCP server run from: ${FOLDERS.ROOT} · a write refused outside the home and its listed roots is policy, not a prompt: the operator lists the directory in .claude/settings.local.json permissions.additionalDirectories and runs ${host.skill('upgrade')} · delivered by the plugin's SessionStart hook because this host has no @-import -->`,
        ...glossary,
        ...files,
        ...(lane.context.trim() ? [`<!-- session context (dynamic lane) -->\n${lane.context.trimEnd()}`] : [])
      ].join('\n\n') + '\n';
    return { systemMessage: banner, additionalContext, hasIssues: lane.hasIssues };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('hook failed', err);
    // Always emit a valid payload — the host treats malformed output as fatal.
    return { systemMessage: '', additionalContext: '', error: message };
  }
}
