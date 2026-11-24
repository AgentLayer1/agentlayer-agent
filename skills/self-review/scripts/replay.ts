#!/usr/bin/env bun
/**
 * Sets up a blind replay of one prompt against the manual as it stood at two or more git refs: a throwaway home
 * per ref holding only the manual, SOUL and IDENTITY from that ref's templates, and a run script that asks each
 * home the same prompt several times. The answers land under names that don't say which ref wrote them; the key
 * is kept apart, to be opened after scoring. The operator runs the script: a host CLI doesn't start in the sandbox.
 *
 * Usage: replay.ts --prompt <file> --refs <ref>,<ref>[,…] [--runs 5] [--model <name>] [--repo <plugin checkout>]
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_AGENT_EMOJI, DEFAULT_AGENT_NAME } from '../../../src/shared/persona';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  args.indexOf(`--${name}`) === -1 ? undefined : args[args.indexOf(`--${name}`) + 1];

const prompt = resolve(flag('prompt') ?? '');
const refs = (flag('refs') ?? '').split(',').filter(Boolean);
const runs = Number(flag('runs') ?? 5);
const model = flag('model');
const repo = resolve(flag('repo') ?? join(import.meta.dir, '..', '..', '..'));
if (!existsSync(prompt) || refs.length < 2 || !Number.isInteger(runs) || runs < 1) {
  console.error('usage: replay.ts --prompt <file> --refs <ref>,<ref>[,…] [--runs 5] [--model <name>] [--repo <dir>]');
  process.exit(2);
}

const TOKENS: Readonly<Record<string, string>> = {
  AGENT_NAME: DEFAULT_AGENT_NAME,
  AGENT_EMOJI: DEFAULT_AGENT_EMOJI,
  KNOWLEDGE_REL: 'knowledge',
  PROJECTS_REL: 'projects',
  PLATFORM: 'macOS'
};
const render = (text: string): string =>
  text.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_match, name: string) => TOKENS[name] ?? name);
const templateAt = (ref: string, file: string): string =>
  execFileSync('git', ['-C', repo, 'show', `${ref}:templates/${file}`], { encoding: 'utf-8' });

const root = mkdtempSync(join(tmpdir(), 'replay-'));
copyFileSync(prompt, join(root, 'prompt.txt'));
mkdirSync(join(root, 'answers'));

const homes = refs.map((ref, i) => {
  const home = join(root, `home-${i + 1}`);
  mkdirSync(join(home, '.claude'), { recursive: true });
  ['AGENTS.md', 'SOUL.md', 'IDENTITY.md'].forEach((file) =>
    writeFileSync(join(home, file), render(templateAt(ref, file)))
  );
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), '@../AGENTS.md\n@../SOUL.md\n@../IDENTITY.md\n');
  return { ref, home };
});

const shuffled = homes
  .flatMap(({ ref, home }) => Array.from({ length: runs }, () => ({ ref, home })))
  .map((run) => ({ run, order: Math.random() }))
  .toSorted((a, b) => a.order - b.order)
  .map(({ run }, i) => ({ ...run, answer: `answer-${String(i + 1).padStart(2, '0')}.txt` }));

writeFileSync(
  join(root, 'key.json'),
  `${JSON.stringify(Object.fromEntries(shuffled.map(({ answer, ref }) => [answer, ref])), null, 2)}\n`
);
writeFileSync(
  join(root, 'run.sh'),
  [
    '#!/bin/zsh',
    `# Replay of one prompt against the manual at: ${refs.join(', ')}. Writes only inside ${root}.`,
    `R=${JSON.stringify(root)}`,
    ...shuffled.map(
      ({ home, answer }, i) =>
        `echo "${i + 1}/${shuffled.length}"; ( cd ${JSON.stringify(home)} && claude -p "$(cat "$R/prompt.txt")"${model ? ` --model ${JSON.stringify(model)}` : ''} < /dev/null > "$R/answers/${answer}" 2> "$R/answers/${answer}.err" )`
    ),
    'echo "done: score the files in $R/answers, then open $R/key.json"',
    ''
  ].join('\n')
);

process.stdout.write(
  `${JSON.stringify({ root, refs, runs, answers: shuffled.length, run: `( cd ${root} && /bin/zsh ./run.sh )` }, null, 2)}\n`
);
