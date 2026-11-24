import { daysBetween } from '../../../src/shared/date';
import type { Asked } from '../../self-review/scripts/quality';

export interface ReviewWatermark {
  lastRun?: string;
  brainLastRun?: string;
  snoozeUntil?: string;
  skippedOn?: string;
  skips?: number;
  asked?: Record<string, Asked>;
}

/** What the brain audit found wrong or worn in the files a session loads, and whether they are over their budget. */
export interface BrainQuality {
  findings: number;
  overBudget: boolean;
}

export interface ReviewDue {
  invoke: string;
  label: string;
  lastRun: string | null;
}

const MONTH = 30;
const WEEK = 7;
// Enough duplicated, closed-but-live or narrative lines that a sitting would clean a real share of what loads.
const QUALITY_FINDINGS = 5;
const isDate = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Whether sync should offer self-review today, and which passes. The brain pass is monthly, and a
 * never-reviewed home becomes due once its oldest session is a month old, so a fresh init stays
 * quiet. The rules pass keeps its feedback rule, and is also due a week after its last run when the loaded files
 * have slipped: enough quality findings, or over their budget. Tomorrow and Skip hold both off.
 */
export const selfReviewDue = (
  review: ReviewWatermark,
  today: string,
  feedbackChangedOn: string | null,
  oldestSessionDay: string | null,
  quality: BrainQuality = { findings: 0, overBudget: false }
): ReviewDue | null => {
  if (isDate(review.snoozeUntil) && today < review.snoozeUntil) {
    return null;
  }
  if (isDate(review.skippedOn) && daysBetween(review.skippedOn, today) < MONTH) {
    return null;
  }
  const brainDue = isDate(review.brainLastRun)
    ? daysBetween(review.brainLastRun, today) >= MONTH
    : isDate(oldestSessionDay) && daysBetween(oldestSessionDay, today) >= MONTH;
  const rulesAge = isDate(review.lastRun) ? daysBetween(review.lastRun, today) : Infinity;
  const newFeedback = feedbackChangedOn !== null && (!isDate(review.lastRun) || feedbackChangedOn >= review.lastRun);
  const manyFindings = quality.findings >= QUALITY_FINDINGS;
  // Like the monthly clause, this one waits for a first rules pass: a fresh home's templates are not yet its own.
  const slipped = isDate(review.lastRun) && rulesAge >= WEEK && (manyFindings || quality.overBudget);
  const rulesDue = (rulesAge >= 14 && newFeedback) || (isDate(review.lastRun) && rulesAge >= MONTH) || slipped;
  if (!brainDue && !rulesDue) {
    return null;
  }
  const skipped = (review.skips ?? 0) >= 2 ? `, skipped ${review.skips} times in a row` : '';
  const why = !rulesDue
    ? ''
    : manyFindings
      ? `: ${quality.findings} lines duplicated, out of date or buried in detail`
      : quality.overBudget
        ? ': the brain is over its budget'
        : '';
  const passes = brainDue && rulesDue ? '' : brainDue ? ' brain' : ' rules';
  const label =
    brainDue && rulesDue ? 'Self-review' : brainDue ? 'Self-review (brain pass)' : 'Self-review (rules pass)';
  const lastRun = (brainDue ? review.brainLastRun : review.lastRun) ?? null;
  return { invoke: `self-review${passes}`, label: `${label}${why}${skipped}`, lastRun };
};
