/*
 * Whether a message (a proposal or a note) shows now. Imports nothing, so the cmux sidebar's bundle can use it.
 */

/**
 * A message shows unless it was put off until a time still to come. `laterUntil` is an ISO time with an offset, or ''.
 */
export const isShown = (laterUntil: string, nowMs: number): boolean =>
  laterUntil === '' || Date.parse(laterUntil) <= nowMs;
