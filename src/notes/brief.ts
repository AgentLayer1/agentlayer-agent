import { FILES, TIMEZONE } from '@/config';
import { todayDate } from '@/shared/date';
import { existsSync, readFileSync } from 'node:fs';
import { redactSecrets } from '@/knowledge/utils';
import { countOf } from '@/shared/utils';
import type { NoteLedger } from './ledger';
import { webLensOf, type HomeLens, type WebLens } from './lenses';
import { roomToday, sentLately } from './rules';

const HEADINGS = ['names', 'sites', 'facts', 'topics', 'place'] as const;
type Heading = (typeof HEADINGS)[number];

/**
 * What the operator lets a web search carry, from `knowledge/public.md`: one bullet per fact under its heading.
 */
export type PublicFacts = Record<Heading, string[]>;

interface PublicRead {
  facts: PublicFacts;
  refused: { line: string; reason: string }[];
}

const EMPTY: PublicFacts = { names: [], sites: [], facts: [], topics: [], place: [] };

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LONG_NUMBER = /\d{5,}/;
// Seven digits apart only by spaces, dashes, dots or brackets read as a phone number.
const PHONE = /(?:\+?\d[\s\-.()]*){7,}/;
const MAX_LENGTH = 160;
// A version in a fact goes stale at the next release; the scout reads the current one from the name's own release page.
const VERSION = /\bv?\d+\.\d+(\.\d+)*\b/;

const siteRefusal = (text: string): string => {
  const url = /^\S+$/.test(text) ? URL.parse(text) : null;
  if (url?.protocol !== 'https:') {
    return 'not one https link';
  }
  return url.username || url.password || url.search || url.hash ? 'a link with credentials, a query or a fragment' : '';
};

// Names can't be told by their shape; what can be is refused here, and the rest is the operator's review of the file.
const refusal = (text: string, heading: Heading): string => {
  if (text.length > MAX_LENGTH) {
    return 'longer than one fact';
  }
  if (redactSecrets(text) !== text) {
    return 'a secret or key, by the same check that keeps them out of session logs';
  }
  if (EMAIL.test(text)) {
    return 'an email address';
  }
  // A public link's numbers (a store listing's id) are part of the address, not a phone or a registration number.
  if (heading === 'sites') {
    return siteRefusal(text);
  }
  if (LONG_NUMBER.test(text) || PHONE.test(text)) {
    return 'a long number (a phone, a registration number, a postcode)';
  }
  return heading === 'facts' && VERSION.test(text)
    ? "a version number, which goes stale at the next release; the scout reads the current one from the name's own release page"
    : '';
};

/**
 * The public facts in a `public.md`, and each bullet left out with why.
 */
export const parsePublic = (markdown: string): PublicRead => {
  const { facts, refused } = markdown.split('\n').reduce<PublicRead & { heading?: Heading }>(
    (read, raw) => {
      const line = raw.trim();
      const heading = /^##\s+(.+)$/.exec(line)?.[1];
      if (heading !== undefined) {
        return { ...read, heading: HEADINGS.find((known) => known === heading.trim().toLowerCase()) };
      }
      const bullet = /^[-*]\s+(.+)$/.exec(line)?.[1]?.trim();
      if (!read.heading || !bullet) {
        return read;
      }
      const reason = refusal(bullet, read.heading);
      return reason
        ? { ...read, refused: [...read.refused, { line: bullet, reason }] }
        : { ...read, facts: { ...read.facts, [read.heading]: [...read.facts[read.heading], bullet] } };
    },
    { facts: EMPTY, refused: [] }
  );
  return { facts, refused };
};

/**
 * The home's public facts, or null when the operator hasn't written them: then no web lens runs.
 */
export const readPublic = (): PublicRead | null => {
  if (!existsSync(FILES.PUBLIC)) {
    return null;
  }
  return parsePublic(readFileSync(FILES.PUBLIC, 'utf-8'));
};

/**
 * Whether the facts give a scout anything to search for.
 */
export const canScout = (facts: PublicFacts): boolean =>
  facts.names.length + facts.sites.length + facts.topics.length > 0;

const listed = (label: string, items: readonly string[]): string[] =>
  items.length ? [`${label}:`, ...items.map((item) => `- ${item}`)] : [];

/**
 * The scout's whole task: one lens, the month, the operator's public facts and the day's room. Nothing else from the
 * home goes in, so a page that steers the scout finds nothing private to send; `note_add` refuses a source noted lately.
 */
export const scoutBrief = (facts: PublicFacts, lens: WebLens, ledger: NoteLedger, now: Date): string => {
  return [
    `Lens: ${lens.key}. Look for ${lens.lookFor}. Where: ${lens.where}.`,
    `Month: ${now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: TIMEZONE })}`,
    ...listed('Place', facts.place),
    ...listed('Names', facts.names),
    ...listed('Sites', facts.sites),
    ...listed('Facts that are true now', facts.facts),
    ...listed('Topics', facts.topics),
    `Room: at most ${countOf(roomToday(ledger, now), 'note')} today.`
  ].join('\n');
};

/**
 * The home lens agent's task: one lens, the day, the room, what was noted lately or dismissed (so not again), the open
 * workspaces to place a note in, and the home's own rules when it has them. It reads the home and reaches no web.
 */
export const homeBrief = (
  lens: HomeLens,
  ledger: NoteLedger,
  now: Date,
  workspaces: readonly string[],
  rulesFile: string
): string => {
  const recent = new Set(sentLately(ledger, now).map((note) => note.id));
  const taken = ledger.notes
    .filter((note) => recent.has(note.id) || note.state === 'dismissed')
    .map((note) => `${note.source} (${note.title})`);
  return [
    `Lens: ${lens.key}. Look for ${lens.lookFor}. Where: ${lens.where}.`,
    `Today: ${todayDate(now)}`,
    `Room: at most ${countOf(roomToday(ledger, now), 'note')} today.`,
    ...listed('Noted lately or dismissed, so not again', taken),
    ...listed('Workspaces open now', workspaces),
    ...(rulesFile
      ? [`The operator's own rules for notes are in ${rulesFile}: read it first; it wins where it disagrees.`]
      : [])
  ].join('\n');
};

/**
 * Whether a lens's notes come from the scout (the web) or the home lens agent.
 */
export const agentFor = (lens: string): 'scout' | 'home-lens' => (webLensOf(lens) ? 'scout' : 'home-lens');
