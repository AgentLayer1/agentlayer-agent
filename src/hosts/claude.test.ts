import { describe, expect, test } from 'bun:test';
import { subscriptionIssue } from '@/hosts/claude';

describe('the Claude subscription guard', () => {
  test('a home with its own subscription warns when the session started without it', () => {
    expect(subscriptionIssue(true, undefined)).toContain('then run "agent"');
  });

  test('a session started with the subscription file, or a home without one, stays quiet', () => {
    expect(subscriptionIssue(true, '1')).toBeNull();
    expect(subscriptionIssue(false, undefined)).toBeNull();
  });
});
