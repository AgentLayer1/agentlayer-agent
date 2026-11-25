import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonBlock } from '../../../src/shared/json-block';
import { THEME_BLOCK } from '../../../src/shared/theme';
import { buildFinance, loadFinance } from './build';
import { loadEntities } from './calendar';
import { renderDashboard } from './dashboard';

const TEMPLATE = join(import.meta.dir, '..', 'references', 'dashboard.html');

const escapeAttribute = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

/**
 * The finances dashboard: the template with this build's data in its `finance-data` block and the
 * tax page framed on its Tax tab. Pure for a given folder and `today`.
 */
export const renderFinances = (dir: string, today: string): string => {
  const data = buildFinance(loadFinance(dir, today));
  const tax =
    loadEntities(dir).length === 0
      ? '<p class="empty">No entity profiles yet: ask your agent to set up your taxes.</p>'
      : `<iframe class="tax" title="Tax" srcdoc="${escapeAttribute(renderDashboard(dir, today))}"></iframe>`;
  const slots: Record<string, string> = {
    TITLE: 'Finances',
    THEME: THEME_BLOCK,
    GENERATED: today,
    TAX: tax,
    DATA: jsonBlock('finance-data', data, 'finances')
  };
  return readFileSync(TEMPLATE, 'utf8').replace(/\{\{([A-Z]+)\}\}/g, (slot, name: string) => slots[name] ?? slot);
};
