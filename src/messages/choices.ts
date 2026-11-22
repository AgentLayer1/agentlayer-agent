/*
 * What a message (a proposal or a note) is to the operator: the three choices on one, what a decision on one returns,
 * and whether it shows now. Imports nothing, so the cmux sidebar's bundle can use it.
 */

export const MESSAGE_CHOICES = ['start', 'later', 'dismiss'] as const;
export type MessageChoice = (typeof MESSAGE_CHOICES)[number];

/**
 * A choice applied to a ledger: the new ledger and the message as it is now, no message by that id, or one already
 * started or dismissed (Start and Dismiss are final).
 */
export type Decision<Ledger, Item> =
  | { outcome: 'decided'; ledger: Ledger; item: Item }
  | { outcome: 'unknown' }
  | { outcome: 'already'; item: Item };

/**
 * A message shows unless it was put off until a time still to come. `laterUntil` is an ISO time with an offset, or ''.
 */
export const isShown = (laterUntil: string, nowMs: number): boolean =>
  laterUntil === '' || Date.parse(laterUntil) <= nowMs;
