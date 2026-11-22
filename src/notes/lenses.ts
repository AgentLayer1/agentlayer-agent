/*
 * The angles a note comes from. A web lens runs in the scout, which reads only the public brief and the pages it
 * opens; a home lens runs in the home lens agent, which reads the home and reaches no web.
 */

export const WEB_LENSES = [
  {
    key: 'public-drift',
    lookFor:
      'a page, store listing, search result or doc about one of the names below that contradicts the facts below: an old version, an old name, a feature called "in progress" that shipped',
    where: "the sites below, the names' store listings, and a web search for each name"
  },
  {
    key: 'opportunities',
    lookFor:
      'something worth acting on within a week that fits one of the names below and the place: an event, a call for demos or talks, a grant or programme, a deadline',
    where: 'a web search on the names and topics below, the place, and the month'
  },
  {
    key: 'signals',
    lookFor: 'news on a topic below that bears on one of the names below',
    where: 'a web search on each topic'
  }
] as const;

export type WebLens = (typeof WEB_LENSES)[number];

export const HOME_LENSES = [
  {
    key: 'brain',
    lookFor:
      'the brain against itself: a fact gone stale, two facts that disagree, a task behind the code, a pending item past its date',
    where: 'knowledge/memory/index.md (Open Questions, Pending), task_query, and the recent decisions'
  },
  {
    key: 'waiting',
    lookFor:
      "something waiting on the operator that a session couldn't see: a review asked of them, a reply owed, new App Store reviews, a support queue growing",
    where: 'github_sweep, helpdesk_stats and appstore_reviews, where those packs are set up'
  }
] as const;

export type HomeLens = (typeof HOME_LENSES)[number];

type LensKey = WebLens['key'] | HomeLens['key'];

export const HOME_LENS_KEYS: readonly [LensKey, ...LensKey[]] = ['brain', 'waiting'];

export const LENS_KEYS: readonly [LensKey, ...LensKey[]] = [...HOME_LENS_KEYS, ...WEB_LENSES.map((lens) => lens.key)];

export const webLensOf = (key: string): WebLens | undefined => WEB_LENSES.find((lens) => lens.key === key);

export const homeLensOf = (key: string): HomeLens | undefined => HOME_LENSES.find((lens) => lens.key === key);
