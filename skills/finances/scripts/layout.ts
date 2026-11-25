import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEntities, pendingCloses } from './calendar';

/**
 * Where the finances project keeps things, and the small shapes every script that reads or writes
 * them shares: the importer writes, the build reads, sync looks at the inbox.
 */

export const Check = { Checked: 'checked', Unchecked: 'unchecked' } as const;
export type Check = (typeof Check)[keyof typeof Check];

export const DATA = {
  inbox: (dir: string): string => join(dir, 'data', 'inbox'),
  originals: (dir: string, entity: string, month: string): string => join(dir, 'data', 'originals', entity, month),
  statements: (dir: string): string => join(dir, 'data', 'statements.csv'),
  transactions: (dir: string, entity?: string): string =>
    entity === undefined ? join(dir, 'data', 'transactions') : join(dir, 'data', 'transactions', entity),
  ledger: (dir: string, entity: string, year: string): string => join(dir, 'data', 'ledger', entity, `${year}.csv`),
  rules: (dir: string): string => join(dir, 'RULES.md')
} as const;

export const cents = (amount: number): number => Math.round(amount * 100);
export const monthOf = (date: string): string => date.slice(0, 7);

/** Every CSV under `dir`, at any depth. */
export const csvFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.csv'))
        .map((file) => join(dir, file))
    : [];

/** Files waiting in the inbox to be imported (not the staged lines of a PDF, nor dotfiles). */
export const waiting = (dir: string): string[] =>
  existsSync(DATA.inbox(dir)) ? readdirSync(DATA.inbox(dir)).filter((name) => !name.startsWith('.')) : [];

export interface Due {
  invoke: string;
  label: string;
  lastRun: null;
}

/**
 * What sync nudges for: a monthly close whose record is missing (the close records are the
 * watermark), and statements waiting in the inbox. Both need the operator, so they are nudges only.
 * A profile the engine refuses is its own item rather than dropping the rest.
 */
export const financesDue = (dir: string, today: string): Due[] => {
  const closes = ((): Due[] => {
    if (!existsSync(join(dir, 'entities'))) {
      return [];
    }
    try {
      const pending = pendingCloses(dir, loadEntities(dir), today);
      const first = pending[0];
      return first === undefined
        ? []
        : [
            {
              invoke: 'finances tax close',
              label: `Tax close for ${first.month} (${pending.map((close) => close.entity).join(', ')})`,
              lastRun: null
            }
          ];
    } catch (error) {
      return [
        {
          invoke: 'finances tax setup',
          label: `Fix the tax profile: ${error instanceof Error ? error.message : String(error)}`,
          lastRun: null
        }
      ];
    }
  })();
  const files = waiting(dir).length;
  return files === 0
    ? closes
    : [
        ...closes,
        {
          invoke: 'finances import',
          label: `Import ${files} statement${files === 1 ? '' : 's'} waiting in the finances inbox`,
          lastRun: null
        }
      ];
};
