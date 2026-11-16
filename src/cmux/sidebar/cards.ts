import { agentCards, bySection, ORDER, type Card } from 'cmux-custom-dashboard/model';
import { homeOf } from './scope';

/**
 * The sessions running in one home (`undefined`: in none), in the dashboard library's order: needs you first,
 * a waiting question ahead of an unread turn, then newest.
 */
export const cardsIn = (homes: readonly string[], home: string | undefined): Card[] => {
  const sections = bySection(agentCards().filter((card) => homeOf(homes, card.agent.directory) === home));
  return ORDER.flatMap((section) => sections[section]);
};

export const needsIn = (homes: readonly string[], home: string): Card[] =>
  cardsIn(homes, home).filter((card) => card.section === 'needs');
