import { expect, spyOn, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { FILES } from '@/config';
import { addNotes } from '@/notes/rules';
import { EMPTY_NOTES, readNotes, writeNotes } from '@/notes/ledger';
import { EMPTY_LEDGER, readProposalLedger, writeProposalLedger } from '@/proposals/ledger';
import { addProposals } from '@/proposals/rules';
import { runMessagesCommand } from './command';

const NOW = new Date('2026-11-22T10:00:00+08:00');

test('decide finds a message by its id in either ledger, and Dismiss means the same for both', () => {
  rmSync(FILES.PROPOSALS, { force: true });
  rmSync(FILES.NOTES, { force: true });
  const said = spyOn(console, 'log').mockImplementation(() => {});
  try {
    const proposal = addProposals(
      EMPTY_LEDGER,
      [
        {
          source: 'task:aa-1',
          title: 'Reply',
          trigger: 't',
          quote: '',
          detail: 'd',
          reach: 'r',
          estimate: '',
          due: '',
          prompt: 'p'
        }
      ],
      NOW
    );
    writeProposalLedger(proposal.ledger);
    const note = addNotes(
      EMPTY_NOTES,
      [
        {
          source: 'site:x',
          lens: 'signals',
          title: 'Found x',
          body: 'b',
          sources: ['https://example.com/x'],
          next: 'n'
        }
      ],
      NOW
    );
    writeNotes(note.ledger);
    const proposalId = proposal.added[0]?.id ?? '';
    const noteId = note.added[0]?.id ?? '';
    expect(runMessagesCommand('decide', ['dismiss', proposalId])).toBe(0);
    expect(runMessagesCommand('decide', ['dismiss', noteId])).toBe(0);
    expect(readProposalLedger().proposals[0]?.state).toBe('dismissed');
    expect(readNotes().notes[0]?.reaction).toBe('dismissed');
    expect(runMessagesCommand('decide', ['dismiss', 'x-9'])).toBe(0);
    expect(said.mock.calls.map(([line]) => String(line))).toEqual([
      'Dismissed: Reply.',
      'Dismissed: Found x.',
      'Nothing waits with the id x-9.'
    ]);
  } finally {
    said.mockRestore();
    rmSync(FILES.PROPOSALS, { force: true });
    rmSync(FILES.NOTES, { force: true });
  }
});
