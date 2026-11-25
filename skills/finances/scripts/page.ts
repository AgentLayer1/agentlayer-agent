#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '../../../src/config';
import { renderTemplate } from '../../../src/knowledge/utils';
import { todayDate } from '../../../src/shared/date';
import { jsonBlock } from '../../../src/shared/json-block';
import { THEME_BLOCK } from '../../../src/shared/theme';
import { escapeHtml } from '../../../src/status/html-primitives';
import { buildFinance, loadFinance } from './build';
import { argValue } from './calendar';
import { renderDashboard } from './dashboard';

/**
 * The finances dashboard: the template with this build's data in its `finance-data` block and the
 * tax page framed on its Tax tab. Pure for a given folder and `today`.
 *
 * Usage: bun page.ts [--today YYYY-MM-DD]   writes <projects>/finances/dashboard.html, prints its path
 */

const TEMPLATE = join(import.meta.dir, '..', 'references', 'dashboard.html');

export const renderFinances = (dir: string, today: string): string => {
  const input = loadFinance(dir, today);
  const tax =
    input.entities.length === 0
      ? '<p class="empty">No entity profiles yet: ask your agent to set up your taxes.</p>'
      : `<iframe class="tax" title="Tax" srcdoc="${escapeHtml(renderDashboard(dir, today))}"></iframe>`;
  return renderTemplate(readFileSync(TEMPLATE, 'utf8'), {
    TITLE: 'Finances',
    THEME: THEME_BLOCK,
    GENERATED: today,
    TAX: tax,
    DATA: jsonBlock('finance-data', buildFinance(input), 'finances')
  });
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dir = argValue(args, '--dir') ?? join(FOLDERS.PROJECTS, 'finances');
  if (!existsSync(dir)) {
    console.error(`no finances project at ${dir}`);
    process.exit(1);
  }
  const path = join(dir, 'dashboard.html');
  writeFileSync(path, renderFinances(dir, argValue(args, '--today') ?? todayDate()));
  console.log(path);
}
