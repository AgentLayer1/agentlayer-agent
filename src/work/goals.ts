import { stripMarkdown } from '@/shared/text';
import type { WorkGoal, WorkGoalBlock } from './model';

export const GOALS_MARKER_START = '<!-- GOALS:START -->';
export const GOALS_MARKER_END = '<!-- GOALS:END -->';

const HEADING = /^## (Daily|Weekly|Monthly|Yearly) Goals(?:\s*[—–-]\s*(.*))?$/;
const HORIZON: Readonly<Record<string, WorkGoalBlock['horizon']>> = {
  Daily: 'day',
  Weekly: 'week',
  Monthly: 'month',
  Yearly: 'year'
};
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+/;
const ITALIC = /^_(.+)_$/;
const PLACEHOLDER = /^_No .+_$/;
const CHECK = /\s*_\((?:success|check):\s*([\s\S]+?)\)_/;
const LABEL = /^\*\*(Q\d(?:\s+\d{4})?)\*\*\s*(✅|❌|🟡|↪)?️?\s*[—–-]\s*/;
// Bold is the headline only when it is the whole headline: what follows is nothing or a separator.
const BOLD = /^\*\*(.+?)\*\*(?=\s*(?:$|[·—–:]))/;
const LEADING_SEPARATOR = /^\s*[·—–:]\s*/;
const DASH = ' — ';
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const THEME = /^(\d{4} theme):\s*(.+)$/;

interface Section {
  horizon: WorkGoalBlock['horizon'];
  heading: string;
  lines: string[];
}

const clean = (text: string): string => stripMarkdown(text).trim();

/**
 * One goal line, its list marker already gone. A bold headline leads when there is one; otherwise the text before
 * ` — ` is the headline and what follows is its check, as weekly goals are written.
 */
export const parseGoal = (line: string): WorkGoal => {
  const label = line.match(LABEL);
  const afterLabel = label ? line.slice(label[0].length) : line;
  const check = afterLabel.match(CHECK);
  const rest = check ? afterLabel.replace(CHECK, '') : afterLabel;
  const bold = rest.match(BOLD);
  const dash = rest.indexOf(DASH);
  const [title, tail] = bold
    ? [bold[1] ?? '', rest.slice(bold[0].length)]
    : dash === -1
      ? [rest, '']
      : [rest.slice(0, dash), rest.slice(dash + DASH.length)];
  const after = clean(tail.replace(LEADING_SEPARATOR, ''));
  const explicit = clean(check?.[1] ?? '');
  return {
    label: label?.[1] ?? '',
    mark: label?.[2] ?? '',
    title: clean(title),
    check: explicit || (bold ? '' : after),
    detail: explicit !== '' || bold !== null ? after : ''
  };
};

const prose = (line: string): string => clean(line.match(ITALIC)?.[1] ?? line);

// An intro line is a run of short facts joined by middle dots.
const segments = (lines: readonly string[]): string[] =>
  lines
    .flatMap((line) => line.split(' · '))
    .map((part) => part.trim())
    .filter(Boolean);

const toBlock = ({ horizon, heading, lines }: Section): WorkGoalBlock => {
  const kept = lines.filter((line) => !PLACEHOLDER.test(line));
  const isGoal = (line: string) => LIST_ITEM.test(line);
  const first = kept.findIndex(isGoal);
  const split = first === -1 ? kept.length : first;
  const intro = segments(kept.slice(0, split).map(prose));
  const [, label = '', text = ''] = intro.map((part) => part.match(THEME)).find(Boolean) ?? [];
  const facts = intro.filter((part) => !THEME.test(part));
  // The goals skill opens a month's intro with the month itself.
  const [caption = '', ...others] = horizon === 'month' ? facts : ['', ...facts];
  return {
    horizon,
    date: heading.match(ISO_DATE)?.[0] ?? '',
    caption,
    theme: text ? { label, text } : null,
    goals: kept.filter(isGoal).map((line) => parseGoal(line.replace(LIST_ITEM, ''))),
    notes: [
      ...others,
      ...kept
        .slice(split)
        .filter((line) => !isGoal(line))
        .map(prose)
    ]
  };
};

/**
 * What TASKS.md holds between a block's markers, '' when they're missing.
 */
export const markerBody = (markdown: string, start: string, end: string): string =>
  markdown.split(start)[1]?.split(end)[0] ?? '';

/**
 * The goal blocks between TASKS.md's goal markers, in file order; none when the markers are missing.
 */
export const parseGoals = (markdown: string): WorkGoalBlock[] =>
  markerBody(markdown, GOALS_MARKER_START, GOALS_MARKER_END)
    .split('\n')
    .map((line) => line.trim())
    .reduce<Section[]>((sections, line) => {
      const heading = line.match(HEADING);
      const horizon = HORIZON[heading?.[1] ?? ''];
      const last = sections.at(-1);
      if (heading && horizon) {
        return [...sections, { horizon, heading: heading[2]?.trim() ?? '', lines: [] }];
      }
      if (!last || !line || line.startsWith('<!--')) {
        return sections;
      }
      return [...sections.slice(0, -1), { ...last, lines: [...last.lines, line] }];
    }, [])
    .map(toBlock);
