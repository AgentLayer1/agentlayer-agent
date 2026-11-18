/**
 * ASCII banner for the SessionStart hook.
 *
 * Colors wrap each line individually: Claude Code's systemMessage renderer
 * resets ANSI state at every newline, so a single open/close around the
 * whole block would only color line 1.
 */

import { ANSI, paint, rgbEscape } from '@/shared/ansi';
import { DEFAULT_AGENT_COLORS, DEFAULT_AGENT_EMOJI, DEFAULT_AGENT_NAME } from '@/shared/persona';

/** Raw (uncolored) wordmark lines + tagline. Exported so other surfaces (e.g.
 *  the `status` screen) can re-colorize them under their own color policy
 *  without inheriting this module's hardcoded SessionStart palette. */
export const BANNER_LINES = [' ╔═╗ ╔═╗ ╔═╗ ╔╗╔ ╔╦╗', ' ╠═╣ ║ ╦ ║╣  ║║║  ║ ', ' ╩ ╩ ╚═╝ ╚═╝ ╝╚╝  ╩ '] as const;
/** The tag for a named agent (IDENTITY.md's Name and Emoji); a missing or unfilled emoji keeps the default one. */
export const bannerTag = (name: string, emoji: string): string =>
  `===${name.toUpperCase()}=== ${emoji && !emoji.includes('{{') ? emoji : DEFAULT_AGENT_EMOJI}`;

export const BANNER_TAG = bannerTag(DEFAULT_AGENT_NAME, DEFAULT_AGENT_EMOJI);

// Before init there's no agent yet, so the banner wears the colors a new one wakes up with.
export const BANNER = [
  ...BANNER_LINES.map((line) => paint(line, ANSI.bold, rgbEscape(DEFAULT_AGENT_COLORS.primary))),
  paint(BANNER_TAG, ANSI.bold, rgbEscape(DEFAULT_AGENT_COLORS.accent))
].join('\n');
