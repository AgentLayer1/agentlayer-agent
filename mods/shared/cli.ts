// Pure helpers only: the engine follows `$` into functions of the calling file, never across
// an import, so each feature file makes its own `$` calls and shares just these.

const LOG_LINE = /^\d{4}-\d{2}-\d{2}T/;

/** The plugin's CLI is `src/cli.ts`, the file its hooks run. */
export const cliArgv = (pluginRoot: string, args: readonly string[]): string[] => ['bun', `${pluginRoot}/src/cli.ts`, ...args];

/**
 * The CLI's first stderr line that isn't a timestamped log line, else a generic exit message.
 */
export const cliError = (stderr: string, args: readonly string[], exitCode: number): Error =>
  new Error(
    stderr.split('\n').find((line) => line.trim() && !LOG_LINE.test(line)) ?? `${args.join(' ')} exited ${exitCode}`
  );
