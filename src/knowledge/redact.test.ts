import { describe, expect, test } from 'bun:test';
import { redactSecrets } from '@/knowledge/utils';

// Assembled from parts so no secret-shaped literal sits in the source.
const fake = (...parts: string[]): string => parts.join('');
const JWT = fake('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJhZGEiLCJyb2xlIjoiYWRtaW4ifQ', '.', 'c2lnbmF0dXJlLXZhbHVlLWhlcmU');

describe('redactSecrets', () => {
  test.each([
    ['a JWT after Bearer', `Authorization: Bearer ${JWT}`, 'c2lnbmF0dXJl'],
    ['a bare JWT', `the session cookie was ${JWT} yesterday`, 'c2lnbmF0dXJl'],
    ['a fine-grained GitHub token', `pat ${fake('github_pat_', '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123')}`, 'github_pat_11'],
    ['a Stripe secret key', `key ${fake('sk', '_live_', '51HxAbCdEfGhIjKlMnOpQrStUv')}`, '51HxAbCdEf'],
    ['an AWS access key id', `aws ${fake('AKIA', 'Z7Q3XK2MBNTW5RLP')}`, 'Z7Q3XK2MBNTW5RLP'],
    ['a Slack bot token', `slack ${fake('xox', 'b-', '1234567890-0987654321-AbCdEfGhIjKlMnOp')}`, 'AbCdEfGhIjKlMnOp']
  ])('redacts %s', (_label, text, secret) => {
    expect(redactSecrets(text)).not.toContain(secret);
  });

  test('leaves prose, hashes and ordinary dotted names alone', () => {
    const prose = 'Commit a1b2c3d4e5f6a7b8c9d0 bumped next.config.ts and the token budget to 2,000.';
    expect(redactSecrets(prose)).toBe(prose);
  });
});
