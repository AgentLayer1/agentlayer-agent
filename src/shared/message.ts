/*
 * What a message (a proposal or a note) is to the operator: the three choices on one, and whether it shows now.
 * Imports nothing, so the cmux sidebar's bundle can use it.
 */

export const MESSAGE_CHOICES = ['start', 'later', 'dismiss'] as const;
export type MessageChoice = (typeof MESSAGE_CHOICES)[number];

/**
 * A message shows unless it was put off until a time still to come. `laterUntil` is an ISO time with an offset, or ''.
 */
export const isShown = (laterUntil: string, nowMs: number): boolean =>
  laterUntil === '' || Date.parse(laterUntil) <= nowMs;
