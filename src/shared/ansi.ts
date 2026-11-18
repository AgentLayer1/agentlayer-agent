const ESC = '\x1b[';

export const ANSI = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  defaultForeground: `${ESC}39m`,
  brightBlue: `${ESC}94m`,
  brightCyan: `${ESC}96m`
} as const;

/**
 * One colored fragment, reset at its end so fragments compose within a line.
 */
export const paint = (text: string, ...codes: string[]): string =>
  codes.length ? `${codes.join('')}${text}${ANSI.reset}` : text;

/** A 24-bit foreground escape for a `#RRGGBB` color. */
export const rgbEscape = (hex: string): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${ESC}38;2;${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}m`;
};

// Codex's ratatui renderer prints escapes as raw bytes, and log files read better without them.
export const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
