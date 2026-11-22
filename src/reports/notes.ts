import type { NoteAdapter } from '@/notes/adapter';
import { slugify } from '@/tasks/mutate';
import { writeReport } from './reports';

/**
 * Every note as a report in `reports/notes/`, so a home with no other way to hear from the agent still keeps them.
 */
export const reportAdapter: NoteAdapter = {
  name: 'report',
  always: true,
  available: () => true,
  deliver: async (note) => {
    const sources = note.sources.map((url) => `- ${url}`).join('\n');
    const start = note.prompt ? `\n\nStart it with \`/note start ${note.id}\`.` : '';
    await writeReport({
      category: 'notes',
      slug: slugify(note.title) || 'note',
      title: note.title,
      skill: 'notes',
      status: 'findings',
      body: `${note.body}\n\n**Next:** ${note.next}${start}\n\n## Sources\n\n${sources}\n`,
      extra: { note: note.id, lens: note.lens, source: note.source }
    });
  }
};
