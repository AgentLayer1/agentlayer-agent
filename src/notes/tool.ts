import { NOTE_ADAPTERS, redrawHome } from '@/adapters';
import { FOLDERS } from '@/config';
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
    .describe('What backs it: full URLs of pages anyone can open, or for a finding about the brain, the home files (knowledge/…, projects/…).'),
  next: text(200).min(1).describe('The one next step, small and concrete: "Inspect the install URL in Search Console and request indexing."'),
  prompt: text(8000)
    .default('')
    .describe(
      'When the next step is work a session can do, its whole first message: what to do, what it may touch (drafts only), and where to stop. Empty otherwise.'
    ),
  folder: text(400)
    .default('')
    .describe('The folder the next step works in: the repo path for code work; empty when none fits.'),
  workspace: text(100)
    .default('')
    .describe(
      "The title of the agent's workspace a session on the next step belongs in, from the list the heartbeat was given; empty when none fits."
    )
});

export const tools: ToolDef[] = [
  defineTool({
    name: 'note_add',
    description: `Send notes: short findings checked against a live source, each with one next step. At most ${DAILY_CAP} a day; a note on a source sent in the last two weeks, or with nothing to back it, is refused. Each note is written to reports/notes/ and delivered through every adapter the home can reach (the heartbeat's tab, notifications, the cmux Manager). Returns what went out, through which adapters, what was refused and why, and how many of the day's cap went out today.`,
    inputSchema: {
      notes: z.array(NOTE).min(1).max(DAILY_CAP).describe('The notes to send, best first.')
    },
    handler: async ({ notes }) => {
      const sent = await sendNotes(notes, NOTE_ADAPTERS, new Date());
      if (sent.added.length) {
        redrawHome(FOLDERS.HOME);
      }
      return sent;
    }
  })
];
