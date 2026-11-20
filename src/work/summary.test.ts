import { expect, test } from 'bun:test';
import { localISO } from '@/shared/date';
import { parseTasksSummary } from './summary';

const block = (inner: string) => `# Tasks\n\n<!-- SUMMARY:START -->\n## Tasks at a Glance\n\n${inner}\n<!-- SUMMARY:END -->\n\n## Active (2)\n`;

test('the summary is its text, joined across lines, and the local time it was written', () => {
  const parsed = parseTasksSummary(
    block('_Written 2026-11-20 09:30 by sync_\n\nCheckout fixes lead the week.\nThe launch waits on both.')
  );
  expect(parsed).toEqual({
    text: 'Checkout fixes lead the week. The launch waits on both.',
    writtenAt: localISO('2026-11-20', '09:30')
  });
});

test('a written line with its offset is read at that offset, whatever the home timezone', () => {
  expect(parseTasksSummary(block('_Written 2026-11-20 09:30 -0500 by the heartbeat_\n\nCheckout leads.'))).toEqual({
    text: 'Checkout leads.',
    writtenAt: '2026-11-20T09:30:00-05:00'
  });
});

test('a missing block, its placeholder, or text with no written line gives no summary', () => {
  expect(parseTasksSummary('# Tasks\n\n## Active (0)\n')).toBeNull();
  expect(parseTasksSummary(block('_No summary yet. Sync writes one._'))).toBeNull();
  expect(parseTasksSummary(block('Checkout fixes lead the week.'))).toBeNull();
});
