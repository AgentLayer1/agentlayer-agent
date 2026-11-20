/*
 * Whether a proposal shows now, and the choices on one. Imports nothing, so the cmux sidebar's bundle can use it.
 */

export const CHOICES = ['start', 'later', 'skip'] as const;
export type Choice = (typeof CHOICES)[number];

/**
 * A proposal shows unless it was put off until a time still to come. `laterUntil` is an ISO time with an offset, or ''.
 */
export const isShown = (laterUntil: string, nowMs: number): boolean =>
  laterUntil === '' || Date.parse(laterUntil) <= nowMs;
