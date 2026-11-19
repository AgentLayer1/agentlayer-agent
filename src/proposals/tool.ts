import { ADAPTERS } from '@/adapters';
import { FOLDERS } from '@/config';
import { defineTool, type ToolDef } from '@/shared/tool-def';
import { z } from 'zod';
import { readProposalLedger, writeProposalLedger } from './ledger';
import { addProposals, BACKLOG, showingNow, TARGET } from './rules';
import { publishTo } from './start';

const text = (max: number) => z.string().trim().max(max);

const PROPOSAL = z.object({
  source: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9:._/#@-]*$/i, 'a key like task:ab-012, gh:owner/repo#79 or sync')
    .describe(
      'What it comes from, the key that keeps it from being proposed twice: task:<id>, gh:<owner>/<repo>#<n>, sync, or <name>:<key> from a proposal source.'
    ),
  title: text(100).min(1).describe('What the session does, as an imperative: "Finish the reply to your accountant".'),
  trigger: text(160).min(1).describe('What happened that made you propose it: "Your accountant wrote two hours ago".'),
  quote: text(200).default('').describe("The source's own words when they help, else empty."),
  detail: text(400).min(1).describe('One or two sentences: what the session will do and where it stops.'),
  reach: text(160).min(1).describe('What it may touch: "Drafts the email and sends nothing."'),
  estimate: text(16).min(1).describe('How long it should take: 5m, 15m, 1h.'),
  due: text(24).default('').describe('When it presses, like "due Sat", else empty.'),
  prompt: text(8000)
    .min(1)
    .describe(
      'The whole first message for a fresh session that has none of this context: what to do, the task or issue id, what it may touch (drafts only, never sends), and where to stop.'
    )
});

export const tools: ToolDef[] = [
  defineTool({
    name: 'proposal_add',
    description: `Propose sessions for the operator to start later. Each waits in Proposals until they choose Start (a fresh session runs its prompt), Later (back tomorrow morning) or Skip. A source already waiting, started in the last day or skipped in the last week is refused, as is anything past ${BACKLOG} waiting. Returns what was added, what was refused and why, and what's showing (the heartbeat keeps ${TARGET}).`,
    inputSchema: {
      proposals: z.array(PROPOSAL).min(1).max(10).describe('The sessions to propose, best first.')
    },
    handler: async ({ proposals }) => {
      const now = new Date();
      const { ledger, added, refused } = addProposals(readProposalLedger(), proposals, now);
      if (added.length) {
        writeProposalLedger(ledger);
        publishTo(ADAPTERS, FOLDERS.HOME);
      }
      return {
        added: added.map(({ id, title }) => ({ id, title })),
        refused,
        showing: showingNow(ledger, now).map(({ id, title }) => ({ id, title }))
      };
    }
  })
];
