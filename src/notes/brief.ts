import { FILES, TIMEZONE } from '@/config';
import { existsSync, readFileSync } from 'node:fs';
import type { NoteLedger } from './ledger';
import { webLensOf, type WebLens } from './lenses';
import { roomToday, sentLately } from './rules';

/**
 * What the operator lets a web search carry, from `knowledge/public.md`: one bullet per fact under its heading.
 */
export interface PublicFacts {
  names: string[];
  sites: string[];
  facts: string[];
  topics: string[];
  place: string[];
}

interface Refused {
  line: string;
  reason: string;
}

const HEADINGS: Record<string, keyof PublicFacts> = {
  names: 'names',
  sites: 'sites',
  facts: 'facts',
  topics: 'topics',
  place: 'place'
};

const EMPTY: PublicFacts = { names: [], sites: [], facts: [], topics: [], place: [] };

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LONG_NUMBER = /\d{5,}/;
// Seven digits apart only by spaces, dashes, dots or brackets read as a phone number.
const PHONE = /(?:\+?\d[\s\-.()]*){7,}/;
const MAX_LENGTH = 160;

const siteRefusal = (text: string): string => {
  const url = /^\S+$/.test(text) ? URL.parse(text) : null;
  if (url?.protocol !== 'https:') {
    return 'not one https link';
  }
  return url.username || url.password || url.search || url.hash ? 'a link with credentials, a query or a fragment' : '';
};

// Names can't be told by their shape; what can be is refused here, and the rest is the operator's review of the file.
const refusal = (text: string, heading: keyof PublicFacts): string => {
  if (text.length > MAX_LENGTH) {
    return 'longer than one fact';
  }
  if (EMAIL.test(text)) {
    return 'an email address';
  }
  if (LONG_NUMBER.test(text) || PHONE.test(text)) {
    return 'a long number (a phone, a registration number, a postcode)';
  }
  return heading === 'sites' ? siteRefusal(text) : '';
};

/**
 * The public facts in a `public.md`, and each bullet left out with why.
 */
export const parsePublic = (markdown: string): { facts: PublicFacts; refused: Refused[] } =>
  markdown.split('\n').reduce<{ facts: PublicFacts; refused: Refused[]; heading?: keyof PublicFacts }>(
    (read, raw) => {
      const line = raw.trim();
      const heading = /^##\s+(.+)$/.exec(line)?.[1];
      if (heading !== undefined) {
        return { ...read, heading: HEADINGS[heading.trim().toLowerCase()] };
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

/**
 * The home's public facts, or null when the operator hasn't written them: then no web lens runs.
 */
export const readPublic = (): { facts: PublicFacts; refused: Refused[] } | null => {
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

// Sources a scout already noted lately, or that the operator dismissed. Only web lenses' keys: a home lens's key can
// name a person or a private task.
const takenByScouts = (ledger: NoteLedger, now: Date): string[] => {
  const recent = new Set(sentLately(ledger, now).map((note) => note.id));
  return [
    ...new Set(
      ledger.notes
        .filter((note) => webLensOf(note.lens) && (recent.has(note.id) || note.state === 'dismissed'))
        .map((note) => note.source)
    )
  ];
};

const listed = (label: string, items: readonly string[]): string[] =>
  items.length ? [`${label}:`, ...items.map((item) => `- ${item}`)] : [];

/**
 * The scout's whole task: one lens, the month, the operator's public facts and the day's room. Nothing else from the
 * home goes in, so a page that steers the scout finds nothing private to send.
 */
export const scoutBrief = (facts: PublicFacts, lens: WebLens, ledger: NoteLedger, now: Date): string => {
  const taken = takenByScouts(ledger, now);
  const room = roomToday(ledger, now);
  return [
    `Lens: ${lens.key}. Look for ${lens.lookFor}. Where: ${lens.where}.`,
    `Month: ${now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: TIMEZONE })}`,
    ...listed('Place', facts.place),
    ...listed('Names', facts.names),
    ...listed('Sites', facts.sites),
    ...listed('Facts that are true now', facts.facts),
    ...listed('Topics', facts.topics),
    `Room: at most ${room} note${room === 1 ? '' : 's'} today.`,
    ...(taken.length ? [`Already noted, so not again: ${taken.join(', ')}`] : [])
  ].join('\n');
};
