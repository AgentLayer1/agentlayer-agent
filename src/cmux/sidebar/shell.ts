/**
 * A path as one single-quoted shell word, whatever it holds.
 */
export const shellQuote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

/**
 * A prompt with its line breaks turned into spaces: a newline typed into a terminal would send it.
 */
export const oneLine = (text: string): string => text.replace(/[\r\n]+/g, ' ');

/**
 * The line that starts an agent in its home from any shell.
 */
export const startCommand = (home: string, launcher: string): string => `cd ${shellQuote(home)} && ${launcher}`;
