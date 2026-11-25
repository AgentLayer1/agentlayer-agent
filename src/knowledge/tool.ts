/**
 * Knowledge MCP tools. None of them calls the LLM: compile is skill-orchestrated, so the skill
 * loops over `compile_next`, does the synthesis itself (Read/Write/Edit in the host session,
 * billed to its subscription), then confirms with `compile_write`; the rest are mechanical.
 */
import { capture, type CaptureKind } from '@/knowledge/capture';
import { getStatus, markComplete, pickNext } from '@/knowledge/compile';
import { rewriteAllWikilinks } from '@/knowledge/links';
import { run as runLint } from '@/knowledge/lint';
import { pruneMemory } from '@/knowledge/prune';
import { log as baseLog } from '@/shared/log';
import { RUNTIME_DIR } from '@/shared/naming';
import { defineTool, type ToolDef } from '@/shared/tool-def';
import { z } from 'zod';

const captureLog = baseLog.knowledge.with('capture');
const compileLog = baseLog.knowledge.with('compile');

const KINDS: [CaptureKind, ...CaptureKind[]] = ['inbox', 'feedback', 'finance'];

export const tools: ToolDef[] = [
  defineTool({
    name: 'capture',
    description:
      "Capture any input (a thought, snippet, dropped file, URL) into the agent's raw tree for the next knowledge-compile to absorb. Default kind=inbox writes a timestamped doc to raw/inbox/. kind=feedback appends to raw/user/feedback.md instead (operator-meta — corrections/preferences/rules; compiled into memory/index.md → Learnings). kind=finance copies a bank, card or platform statement or export (file only, byte for byte, original left in place) into projects/finances/data/inbox/ for the finances skill's import playbook, which catches one already imported. Local-only, secret-redacted (text kinds), atomic, content-hash deduped.",
    inputSchema: {
      text: z.string().optional().describe('Inline text to capture. Provide one of text, url, or file.'),
      file: z.string().optional().describe('Absolute or relative path to a file to capture. Read fully and ingested.'),
      url: z
        .string()
        .optional()
        .describe(
          'HTTP(S) URL to fetch and capture. HTML responses are stripped of <script>/<style>/<head>/comments; <title> becomes the heading. Provenance stored as source: url:<url> in frontmatter.'
        ),
      kind: z
        .enum(KINDS)
        .optional()
        .describe(
          'Default "inbox". Use "feedback" for corrections / preferences / rules — appends to raw/user/feedback.md instead. Use "finance" with file for a statement or export to import.'
        ),
      title: z
        .string()
        .optional()
        .describe('Optional title — becomes filename slug + frontmatter title (inbox kind only).'),
      label: z
        .string()
        .optional()
        .describe('Optional label stored in frontmatter (inbox) or in the feedback entry header.'),
      quote: z
        .string()
        .optional()
        .describe(
          "Feedback only: the operator's own words, verbatim. The entry is keyed on them, so the same statement is recorded once (duplicate: true on a repeat)."
        ),
      session: z
        .string()
        .optional()
        .describe(
          'Feedback only, with quote: the id of the session the words were said in, from its session-log block header.'
        ),
      date: z
        .string()
        .optional()
        .describe('Feedback only, with quote: that session block\'s date, YYYY-MM-DD. Defaults to today.')
    },
    handler: async (args) => {
      const result = await capture(args);
      captureLog.info(`${result.duplicate ? 'duplicate' : 'wrote'} ${result.kind} → ${result.relPath}`);
      return result;
    }
  }),
  defineTool({
    name: 'compile_status',
    description: 'How many raw items are pending compilation (sessions/feedback/inbox).',
    inputSchema: {},
    handler: async () => getStatus()
  }),
  defineTool({
    name: 'compile_next',
    description:
      'Return the next compile work item: a rendered prompt + source content + metadata. Caller synthesises wiki articles per the prompt (using Read/Write/Edit), then confirms via compile_write. Returns { done: true } when nothing pending.',
    inputSchema: {},
    // A chunk plus its task section passes Claude Code's 25K-token default, which parks the result in a file the caller must page through.
    meta: { 'anthropic/maxResultSizeChars': 200_000 },
    handler: async () => {
      const item = await pickNext();
      if (item) compileLog.info(`next → ${item.itemId} (${item.kind})`);
      else compileLog.info('next → done (nothing pending)');
      return item ? { done: false, item } : { done: true, item: null };
    }
  }),
  defineTool({
    name: 'compile_write',
    description: 'Mark a compile work item complete. Persists state — promotes to ingested or advances chunk counter.',
    inputSchema: {
      itemId: z.string().describe('Opaque ID returned by compile_next, e.g. "session:2026-05-16.md:0"')
    },
    handler: async ({ itemId }) => {
      const result = await markComplete(itemId);
      compileLog.info(`write ← ${itemId}`);
      return result;
    }
  }),
  defineTool({
    name: 'memory_prune',
    description: 'Delete daily memory files older than the retention window (default 14 days).',
    inputSchema: {},
    handler: async () => {
      await pruneMemory();
      return { ok: true };
    }
  }),
  defineTool({
    name: 'links_rewrite',
    description: 'Normalize bare task IDs and shorthand references into [[wikilinks]] across the knowledge base.',
    inputSchema: {},
    handler: async () => {
      const modified = await rewriteAllWikilinks();
      return { modified, count: modified.length };
    }
  }),
  defineTool({
    name: 'knowledge_lint',
    description: `Run structural health checks across the wiki (broken links, orphan pages, orphan sources, missing backlinks, sparse articles, transient memory refs in permanent articles, invalid frontmatter). Writes a report to ${RUNTIME_DIR}/lint.md. Pass fix:true to auto-rewrite stale wikilinks and insert missing backlinks.`,
    inputSchema: {
      fix: z.boolean().optional().describe('Run auto-fix pass (default false)')
    },
    handler: async ({ fix }) => runLint({ fixMode: fix ?? false })
  })
];
