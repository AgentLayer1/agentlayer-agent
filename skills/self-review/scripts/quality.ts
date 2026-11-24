import { normalizedWords } from '../../../src/knowledge/feedback-keys';
import { TASK_REF } from '../../../src/tasks/prefix';

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

const TASK_ID = new RegExp(`\\b${TASK_REF}\\b`, 'g');
const ITEM = /^\s*(?:[-*]|\d+\.)\s+(.*)$/;
const FENCE = /^ {0,3}(```|~~~)/;

const excerpt = (text: string): string => (text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text);

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

const contentWords = (text: string): Set<string> =>
  new Set(
    normalizedWords(text)
      .split(' ')
      .filter((word) => word.length > 2)
  );

export interface Duplicate {
  file: string;
  line: number;
  text: string;
  with: { file: string; line: number; text: string };
}

/**
 * Sentences in different files that say the same thing: nearly all the content words of the shorter one appear in
 * the other. A lead for the operator, not proof: a pointer to an article can look like its copy.
 */
export const findDuplicates = (units: readonly Item[]): Duplicate[] => {
  const worded = units
    .map((unit) => ({ unit, words: contentWords(unit.text) }))
    .filter(({ words }) => words.size >= MIN_WORDS);
  return worded.flatMap(({ unit, words }, position) =>
    worded
      .slice(position + 1)
      .filter(({ unit: other }) => other.file !== unit.file)
      .filter(
        ({ words: others }) =>
          [...words].filter((word) => others.has(word)).length >= SHARED * Math.min(words.size, others.size)
      )
      .map(({ unit: other }) => ({
        file: unit.file,
        line: unit.line,
        text: excerpt(unit.text),
        with: { file: other.file, line: other.line, text: excerpt(other.text) }
      }))
  );
};

export interface ClosedRef {
  file: string;
  line: number;
  text: string;
  ids: string[];
}

/** Items that name only tasks already done or cancelled, so they speak of finished work as if it were live. */
export const findClosedRefs = (
  items: readonly Item[],
  known: ReadonlySet<string>,
  closed: ReadonlySet<string>
): ClosedRef[] =>
  items.flatMap((item) => {
    const ids = [...new Set(item.text.match(TASK_ID) ?? [])].filter((id) => known.has(id));
    return ids.length > 0 && ids.every((id) => closed.has(id))
      ? [{ file: item.file, line: item.line, text: excerpt(item.text), ids }]
      : [];
  });

const MARKERS = [
  new RegExp(`\\b${TASK_REF}\\b`, 'g'),
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /(?<![\d-])\d{1,2}-\d{2}(?![\d-])/g,
  /\b(?:recurred|again|twice|third time|fourth time)\b/gi
];

export interface Narrative {
  file: string;
  line: number;
  text: string;
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
    return markers >= NARRATIVE_MARKERS
      ? [{ file: item.file, line: item.line, text: excerpt(item.text), markers, chars: item.text.length }]
      : [];
  });
