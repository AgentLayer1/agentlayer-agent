#!/usr/bin/env bun
/**
 * How well a home's sessions followed two rules that can be counted, week by week, from its Claude Code
 * transcripts: commit messages passed with `-F`, and shell calls that open with a bare `cd`. Also the median
 * tokens a session started with, and the operator's corrections per 1,000 replies, counted from the dated,
 * keyed entries the compile records in the feedback log. A week with enough calls that falls outside a
 * threshold is listed as a regression, so a change to the manual can be checked against the weeks before it.
 * Read-only, and it reads only a record's timestamp, model, token usage, tool name and shell command.
 *
 * Usage: rule-compliance.ts [--home <dir>] [--transcripts <dir>] [--feedback <file>] [--since YYYY-MM-DD]
 *        (--home: else the agent's home variable, else the cwd; --since: else eight weeks ago;
 *         --transcripts without --feedback counts no corrections)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { keyedEntries, NO_SESSION } from '../../../src/knowledge/feedback-keys';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  args.indexOf(`--${name}`) === -1 ? undefined : args[args.indexOf(`--${name}`) + 1];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const THRESHOLDS = { fileShareMin: 0.88, cdPer1000Max: 12, minCommits: 20, minShellCalls: 200 } as const;

const homeFlag = flag('home');
if (homeFlag) {
  process.env.AGENT_HOME = resolve(homeFlag);
}

const transcriptsFor = async (): Promise<string> => {
  const { agentHomePath, isAgentHome } = await import('../../../src/shared/env');
  const home = agentHomePath();
  if (!isAgentHome(home)) {
    console.error(`not an agent home: ${home}`);
    process.exit(2);
  }
  // Claude Code names a transcript folder after the launch folder, with every other character flattened to "-".
  return join(homedir(), '.claude', 'projects', home.replace(/[^A-Za-z0-9-]/g, '-'));
};

const transcriptsFlag = flag('transcripts');
const feedbackFlag = flag('feedback');
const homeFeedback = async (): Promise<string | null> =>
  transcriptsFlag ? null : (await import('../../../src/config')).FILES.FEEDBACK;

const transcripts = transcriptsFlag ? resolve(transcriptsFlag) : await transcriptsFor();
const feedback = feedbackFlag ? resolve(feedbackFlag) : await homeFeedback();
const since = flag('since') ?? new Date(Date.now() - 8 * WEEK_MS).toISOString().slice(0, 10);

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}
interface Block {
  type?: string;
  id?: string;
  name?: string;
  input?: { command?: unknown };
}
interface Row {
  type?: string;
  isSidechain?: boolean;
  timestamp?: string;
  message?: { id?: string; model?: string; usage?: Usage; content?: Block[] };
}
interface Week {
  sessions: Set<string>;
  shellCalls: number;
  leadingCd: number;
  commits: number;
  commitsWithFile: number;
  firstTurns: number[];
  replies: Set<string>;
  corrections: number;
}

const mondayOf = (stamp: string): string => {
  const day = new Date(`${stamp.slice(0, 10)}T00:00:00Z`);
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
};

const parse = (line: string): Row | null => {
  try {
    return JSON.parse(line) as Row;
  } catch {
    return null;
  }
};

const isGitCommitCall = (command: string): boolean =>
  /\bgit(\s+-[Cc]\s+\S+|\s+--[\w-]+(=\S+)?)*\s+commit\b/.test(command) && !/commit\s+--help/.test(command);
const usesMessageFile = (command: string): boolean => /commit\b[^|;&]*\s(-F|--file)\b/.test(command);
const tokensOf = (usage: Usage): number =>
  (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);

const weeks = new Map<string, Week>();
const weekFor = (stamp: string): Week => {
  const key = mondayOf(stamp);
  const found = weeks.get(key);
  if (found) {
    return found;
  }
  const made: Week = {
    sessions: new Set(),
    shellCalls: 0,
    leadingCd: 0,
    commits: 0,
    commitsWithFile: 0,
    firstTurns: [],
    replies: new Set(),
    corrections: 0
  };
  weeks.set(key, made);
  return made;
};

const files = existsSync(transcripts)
  ? readdirSync(transcripts)
      .filter((name) => name.endsWith('.jsonl'))
      .filter((name) => statSync(join(transcripts, name)).mtimeMs >= Date.parse(since))
  : [];
files.forEach((name) => {
  const seenCalls = new Set<string>();
  const all = readFileSync(join(transcripts, name), 'utf-8')
    .split('\n')
    .filter((line) => line.includes('"assistant"') && (line.includes('"tool_use"') || line.includes('"usage"')))
    .map(parse)
    .filter((row): row is Row => row !== null && row.type === 'assistant' && row.isSidechain !== true)
    .filter((row) => typeof row.timestamp === 'string');
  const inWindow = (row: Row): boolean => (row.timestamp ?? '').slice(0, 10) >= since;
  const rows = all.filter(inWindow);

  const sessionFirstTurn = all.find((row) => row.message?.usage && row.message.model !== '<synthetic>');
  if (
    sessionFirstTurn?.timestamp &&
    inWindow(sessionFirstTurn) &&
    sessionFirstTurn.message?.usage &&
    tokensOf(sessionFirstTurn.message.usage) > 0
  ) {
    weekFor(sessionFirstTurn.timestamp).firstTurns.push(tokensOf(sessionFirstTurn.message.usage));
  }

  rows.forEach((row) => {
    const week = weekFor(row.timestamp ?? '');
    if (row.message?.id && row.message.model !== '<synthetic>') {
      week.replies.add(row.message.id);
    }
    (row.message?.content ?? [])
      .filter((block) => block.type === 'tool_use' && block.name === 'Bash' && typeof block.id === 'string')
      .filter((block) => !seenCalls.has(block.id ?? ''))
      .forEach((block) => {
        seenCalls.add(block.id ?? '');
        const command = String(block.input?.command ?? '').trim();
        week.sessions.add(name);
        week.shellCalls += 1;
        week.leadingCd += /^cd\s+\S/.test(command) ? 1 : 0;
        const commits = isGitCommitCall(command);
        week.commits += commits ? 1 : 0;
        week.commitsWithFile += commits && usesMessageFile(command) ? 1 : 0;
      });
  });
});

const recorded =
  feedback && existsSync(feedback)
    ? keyedEntries(readFileSync(feedback, 'utf-8'))
        .filter((entry) => entry.session !== NO_SESSION)
        .map((entry) => entry.day)
    : [];
const correctionsRecorded = recorded.length > 0;
recorded
  .filter((day) => day >= since)
  .forEach((day) => {
    weekFor(day).corrections += 1;
  });

const median = (values: number[]): number | null =>
  values.length === 0 ? null : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const report = [...weeks.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([week, tally]) => ({
    week,
    sessions: tally.sessions.size,
    shellCalls: tally.shellCalls,
    leadingCd: tally.leadingCd,
    cdPer1000: tally.shellCalls === 0 ? null : Math.round((tally.leadingCd / tally.shellCalls) * 10_000) / 10,
    commits: tally.commits,
    commitsWithFile: tally.commitsWithFile,
    fileShare: tally.commits === 0 ? null : Math.round((tally.commitsWithFile / tally.commits) * 100) / 100,
    firstTurnMedian: median(tally.firstTurns),
    replies: tally.replies.size,
    corrections: correctionsRecorded ? tally.corrections : null,
    correctionsPer1000:
      correctionsRecorded && tally.replies.size > 0
        ? Math.round((tally.corrections / tally.replies.size) * 10_000) / 10
        : null
  }));

const regressions = report.flatMap((week) => [
  ...(week.commits >= THRESHOLDS.minCommits && week.fileShare !== null && week.fileShare < THRESHOLDS.fileShareMin
    ? [{ week: week.week, rule: 'commit -F', value: week.fileShare }]
    : []),
  ...(week.shellCalls >= THRESHOLDS.minShellCalls && week.cdPer1000 !== null && week.cdPer1000 > THRESHOLDS.cdPer1000Max
    ? [{ week: week.week, rule: 'leading cd', value: week.cdPer1000 }]
    : [])
]);

process.stdout.write(
  `${JSON.stringify({ transcripts, since, thresholds: THRESHOLDS, weeks: report, regressions }, null, 2)}\n`
);
