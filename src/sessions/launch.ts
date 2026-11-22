import { FOLDERS, homeLauncher } from '@/config';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Where a session lives, in the terms of the one launcher that can reach it again. The union grows by a member per
 * launcher, so each one's fields stay typed.
 */
export type SessionPlace = { adapter: 'cmux'; surfaceId: string; workspaceId: string };

export type Launcher = ReturnType<typeof homeLauncher>;

const shellQuoted = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;

/**
 * The shell line that starts the launcher on a prompt file's text; the path is quoted, so nothing in it runs as shell.
 */
export const promptLaunch = (launcher: Launcher, promptPath: string): string =>
  `${launcher} "$(cat ${shellQuoted(promptPath)})"`;

export interface StartInput {
  home: string;
  /**
   * Absolute path of the file holding the prompt the new session runs.
   */
  promptFile: string;
  launcher: Launcher;
}

/**
 * Something that can find this session and open another beside it: a workspace app, a terminal multiplexer.
 */
export interface SessionLauncher {
  name: SessionPlace['adapter'];
  /**
   * The current process's place when this launcher can reach it, read from the environment the process inherited.
   */
  locate: (env: Readonly<Record<string, string | undefined>>) => SessionPlace | null;
  /**
   * Opens a session running the prompt beside `place`, the one `locate` returned, and says where it opened.
   */
  start: (input: StartInput, place: SessionPlace) => string;
}

export interface StartContext {
  home: string;
  adapters: readonly SessionLauncher[];
  env: Readonly<Record<string, string | undefined>>;
  now: Date;
  /**
   * The workspace a Start opens in, when the surface picked one; else beside the session that asked.
   */
  workspace?: string;
}

// A started session reads its prompt as it opens; a day later the file has done its job.
const PROMPT_KEEP_MS = 24 * 60 * 60 * 1000;

const writePromptFile = ({ id, prompt }: { id: string; prompt: string }, now: Date): string => {
  const dir = FOLDERS.PROMPTS;
  mkdirSync(dir, { recursive: true });
  readdirSync(dir)
    .map((name) => resolve(dir, name))
    .filter((path) => now.getTime() - statSync(path).mtimeMs > PROMPT_KEEP_MS)
    .forEach((path) => rmSync(path, { force: true }));
  const path = resolve(dir, `${id}.prompt`);
  writeFileSync(path, prompt);
  return path;
};

const manualStart = ({ home, promptFile, launcher }: StartInput): string =>
  `To start it, run from ${home}: ${promptLaunch(launcher, promptFile)}`;

interface Located {
  adapter: SessionLauncher;
  place: SessionPlace;
}

const locateIn = (adapters: readonly SessionLauncher[], env: StartContext['env']): Located | undefined =>
  adapters.flatMap((adapter): Located[] => {
    const place = adapter.locate(env);
    return place ? [{ adapter, place }] : [];
  })[0];

/**
 * Opens a session on a prompt through the first launcher that can reach this session, beside it (or in the workspace
 * the context names), and says where; with none, the command to run by hand.
 */
export const startPrompt = (
  item: { id: string; prompt: string },
  context: StartContext
): { where: string } | { error: string } => {
  const input: StartInput = {
    home: context.home,
    promptFile: writePromptFile(item, context.now),
    launcher: homeLauncher(context.home)
  };
  const found = locateIn(context.adapters, context.env);
  const located =
    found && context.workspace ? { ...found, place: { ...found.place, workspaceId: context.workspace } } : found;
  try {
    return { where: located ? located.adapter.start(input, located.place) : manualStart(input) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};
