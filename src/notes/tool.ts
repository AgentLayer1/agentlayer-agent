import { NOTE_ADAPTERS } from '@/adapters';
import { defineTool, type ToolDef } from '@/shared/tool-def';
import { z } from 'zod';
import { DAILY_CAP } from './rules';
import { sendNotes } from './send';

const text = (max: number) => z.string().trim().max(max);

const NOTE = z.object({
  source: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9:._/#@-]*$/i, 'a key like site:install-snippet, task:ab-012 or event:demo-day-2026')
    .describe('What it is about, the key that keeps it from being sent twice in two weeks.'),
  lens: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .describe('The lens it came from: public-drift, opportunities, signals, brain, or waiting, or one the home added.'),
  title: text(80).min(1).describe('The finding in one line, as a headline: "The install snippet in search still names the old plugin".'),
  body: text(600)
    .min(1)
    .describe('Two or three sentences: what changed or what you found, and what you checked to be sure.'),
  sources: z
    .array(z.string().trim().max(500))
    .min(1)
    .max(5)
    .describe('The public pages that back it, as full https URLs.'),
  next: text(200).min(1).describe('The one next step, small and concrete: "Inspect the install URL in Search Console and request indexing."'),
  prompt: text(8000)
    .default('')
    .describe(
      'When the next step is work a session can do, its whole first message: what to do, what it may touch (drafts only), and where to stop. Empty otherwise.'
    )
});

export const tools: ToolDef[] = [
  defineTool({
    name: 'note_add',
    description: `Send notes: short findings checked against a live public source, each with one next step. At most ${DAILY_CAP} a day; a note on a source sent in the last two weeks, or with no public source URL, is refused. Each note is written to reports/notes/ and delivered through every adapter the home can reach (the heartbeat's tab, notifications, the cmux Manager). Returns what went out, through which adapters, what was refused and why, and the room left today.`,
    inputSchema: {
      notes: z.array(NOTE).min(1).max(DAILY_CAP).describe('The notes to send, best first.')
    },
    handler: async ({ notes }) => sendNotes(notes, NOTE_ADAPTERS, new Date())
  })
];
