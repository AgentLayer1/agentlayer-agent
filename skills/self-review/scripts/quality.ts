import { relative, resolve, sep } from 'node:path';
import { FILES, FOLDERS } from '../../../src/config';
import { contentWords } from '../../../src/knowledge/feedback-keys';
import { hashBuffer } from '../../../src/knowledge/utils';
import { readTextIfExists } from '../../../src/shared/text';
import { importedStack, injectedStack } from '../../../src/shared/weight';
import { truncate } from '../../../src/status/format';
import { TASK_REF } from '../../../src/tasks/prefix';
import { scanAllTasks, scanArchivedTasks } from '../../../src/tasks/scan';

export interface Doc {
  file: string;
  text: string;
}

export interface Item {
  file: string;
  line: number;
  section: string;
  text: string;
}

const MIN_WORDS = 6;
const SHARED = 0.8;
const NARRATIVE_MARKERS = 3;
const EXCERPT = 160;
const KEEP_DAYS = 90;
const DAY_MS = 86_400_000;

export const TASK_ID = new RegExp(`\\b${TASK_REF}\\b`, 'g');
const ITEM = /^\s*(?:[-*]|\d+\.)\s+(.*)$/;
const FENCE = /^ {0,3}(```|~~~)/;
const SENTENCE_END = /(?<=[.;:!?])\s+(?=[A-Z*`(])/;

/** A file's prose lines outside its code fences and headings, each with its line number and `##` section. */
const proseLines = ({ file, text }: Doc): Item[] =>
  text.split('\n').reduce<{ lines: Item[]; section: string; fenced: boolean }>(
    (state, raw, index) => {
      if (FENCE.test(raw)) {
        return { ...state, fenced: !state.fenced };
      }
      if (state.fenced) {
        return state;
      }
      if (raw.startsWith('#')) {
        return { ...state, section: raw.startsWith('## ') ? raw.slice(3).trim() : state.section };
      }
      return { ...state, lines: [...state.lines, { file, line: index + 1, section: state.section, text: raw }] };
    },
    { lines: [], section: '', fenced: false }
  ).lines;

/** The list items of a markdown file, without their bullet or number. */
export const listItems = (doc: Doc): Item[] =>
  proseLines(doc).flatMap((line) => {
    const match = ITEM.exec(line.text);
    return match ? [{ ...line, text: match[1].trim() }] : [];
  });

/** Every sentence a file says outside its code fences and headings. */
export const sentences = (doc: Doc): Item[] =>
  proseLines(doc).flatMap((line) =>
    line.text
      .split(SENTENCE_END)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .map((sentence) => ({ ...line, text: sentence }))
  );

export const namedIds = (text: string, known: ReadonlySet<string>): string[] =>
  [...new Set(text.match(TASK_ID) ?? [])].filter((id) => known.has(id));

interface Row {
  key: string;
  hash: string;
  file: string;
  line: number;
  text: string;
}

const row = (kind: string, item: Item): Row => {
  const hash = hashBuffer(item.text.trim().replace(/\s+/g, ' '));
  return { key: `quality:${kind}:${hash}`, hash, file: item.file, line: item.line, text: truncate(item.text, EXCERPT) };
};

export interface Duplicate extends Row {
  with: { file: string; line: number; text: string };
}

/**
 * Sentences in different files that say the same thing: nearly all the content words of the shorter one appear in
 * the other. A lead for the operator, not proof: a pointer to an article can look like its copy.
 */
export const findDuplicates = (units: readonly Item[]): Duplicate[] => {
  const worded = units
    .map((unit) => {
      const words = contentWords(unit.text);
      return { unit, words: [...words], set: words };
    })
    .filter(({ words }) => words.length >= MIN_WORDS);
  return worded.flatMap((one, position) =>
    worded
      .filter((other, index) => index > position && other.unit.file !== one.unit.file)
      .filter((other) => {
        const [small, large] = one.words.length <= other.words.length ? [one, other] : [other, one];
        return small.words.filter((word) => large.set.has(word)).length >= SHARED * small.words.length;
      })
      .map((other) => ({
        ...row('duplicate', one.unit),
        with: { file: other.unit.file, line: other.unit.line, text: truncate(other.unit.text, EXCERPT) }
      }))
  );
};

export interface ClosedRef extends Row {
  ids: string[];
}

/** Items that name only tasks already done or cancelled, so they speak of finished work as if it were live. */
export const findClosedRefs = (
  items: readonly Item[],
  known: ReadonlySet<string>,
  closed: ReadonlySet<string>
): ClosedRef[] =>
  items.flatMap((item) => {
    const ids = namedIds(item.text, known);
    return ids.length > 0 && ids.every((id) => closed.has(id)) ? [{ ...row('closed', item), ids }] : [];
  });

const MARKERS = [
  TASK_ID,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /(?<![\d-])\d{1,2}-\d{2}(?![\d-])/g,
  /\b(?:recurred|again|twice|third time|fourth time)\b/gi
];

export interface Narrative extends Row {
  markers: number;
  chars: number;
}

/**
 * Items that tell incidents (dates, task ids, "recurred") rather than state a rule. A Learnings bullet's own
 * `Evidence:` clause is its required format, so it is not counted.
 */
export const findNarrative = (items: readonly Item[]): Narrative[] =>
  items.flatMap((item) => {
    const told = item.text.split(/\bEvidence:/)[0];
    const markers = MARKERS.reduce((sum, pattern) => sum + (told.match(pattern)?.length ?? 0), 0);
    return markers >= NARRATIVE_MARKERS ? [{ ...row('narrative', item), markers, chars: item.text.length }] : [];
  });

// A look or a brain refresh reported as news: what the heartbeat's runs left in memory before capture kept them out.
const HEARTBEAT_OUTCOME = [
  /nothing new worth proposing/i,
  /\bproposals? looks?\b/i,
  /\bbrain refresh(?:ed)?\b[^.]*\bcompiled \d+/i
];

/** Memory lines that report what a heartbeat look or refresh found, which says nothing the brain needs. */
export const findHeartbeatNoise = (items: readonly Item[]): Row[] =>
  items.flatMap((item) =>
    HEARTBEAT_OUTCOME.some((pattern) => pattern.test(item.text)) ? [row('heartbeat', item)] : []
  );

const homeRelative = (path: string): string => relative(FOLDERS.HOME, path).split(sep).join('/');

/**
 * Every file a session loads, whatever the host. TASKS.md is generated from the task files and the bridge only
 * imports, so neither is read.
 */
export const loadedDocs = (): Doc[] =>
  [...new Set([...importedStack().files, ...injectedStack().files].map((file) => file.path))]
    .filter((path) => path !== FILES.CLAUDE && path !== resolve(FOLDERS.PROJECTS, 'TASKS.md'))
    .toSorted()
    .map((path) => ({ file: homeRelative(path), text: readTextIfExists(path) }));

/** Every task id the home has had, and which of them are done or cancelled. */
export const taskIds = (): { known: Set<string>; closed: Set<string> } => {
  const live = scanAllTasks().map((task) => task.frontmatter);
  const closed = new Set([
    ...scanArchivedTasks().map((task) => task.frontmatter.id),
    ...live.filter((task) => task.status === 'done' || task.status === 'cancelled').map((task) => task.id)
  ]);
  return { known: new Set([...closed, ...live.map((task) => task.id)]), closed };
};

export interface Asked {
  date: string;
  answer: string;
  hash?: string;
}

/** A Keep answered within 90 days settles an item while its text is unchanged. */
export const keptQuietIn =
  (asked: Readonly<Record<string, Asked>>, today: string) =>
  (key: string, hash = ''): boolean => {
    const entry = asked[key];
    const age = entry ? (Date.parse(today) - Date.parse(entry.date)) / DAY_MS : Infinity;
    return entry?.answer === 'keep' && age < KEEP_DAYS && (entry.hash ?? '') === hash;
  };

/**
 * What is wrong or worn in what a session loads: sentences said twice, lines naming only closed tasks (the memory
 * index's live sections have their own buckets), and rule bullets told as incidents (Learnings, AGENTS.md,
 * SOUL.md), and memory-index lines that only report a heartbeat look or refresh (the daily files that hold more of
 * them prune themselves within two weeks). Leads the operator kept are left out.
 */
export const qualityOf = (
  docs: readonly Doc[],
  { known, closed }: { known: ReadonlySet<string>; closed: ReadonlySet<string> },
  keptQuiet: (key: string, hash: string) => boolean
) => {
  const memoryIndex = homeRelative(FILES.MEMORY);
  const items = docs.flatMap(listItems);
  const fresh = <Found extends Row>(rows: Found[]): Found[] =>
    rows.filter((found) => !keptQuiet(found.key, found.hash));
  const ruleBullet = (item: Item): boolean =>
    item.file === 'AGENTS.md' || item.file === 'SOUL.md' || (item.file === memoryIndex && item.section === 'Learnings');
  return {
    duplicates: fresh(findDuplicates(docs.flatMap(sentences))),
    closedRefs: fresh(
      findClosedRefs(
        items.filter((item) => item.file !== memoryIndex),
        known,
        closed
      )
    ),
    narrative: fresh(findNarrative(items.filter(ruleBullet))),
    heartbeatNoise: fresh(
      findHeartbeatNoise(items.filter((item) => item.file === memoryIndex))
    )
  };
};
