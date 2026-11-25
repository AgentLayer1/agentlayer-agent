/**
 * A hook's payload on stdin, read once: the CLI reads it before the settings load when the home comes from the payload,
 * and the hook verb reads the same text after.
 */
let text: Promise<string> | undefined;

export const hookStdin = (): Promise<string> => (text ??= Bun.stdin.text());
