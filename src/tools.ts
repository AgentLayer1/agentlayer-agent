/**
 * Every MCP tool the server registers, one import per domain. Each domain exports its `tools`
 * from `<domain>/tool.ts`; `src/contracts/tools.test.ts` fails when a `tool.ts` is missing here.
 */
import { tools as api } from '@/api/tool';
import { tools as appstore } from '@/appstore/tool';
import { tools as browser } from '@/browser/tool';
import { tools as database } from '@/database/tool';
import { tools as github } from '@/github/tool';
import { tools as helpdesk } from '@/helpdesk/tool';
import { tools as home } from '@/home/tool';
import { tools as knowledge } from '@/knowledge/tool';
import { tools as media } from '@/media/tool';
import { tools as reports } from '@/reports/tool';
import { tools as seed } from '@/seed/tool';
import { tools as seo } from '@/seo/tool';
import type { ToolDef } from '@/shared/types';
import { tools as slack } from '@/slack/tool';
import { tools as status } from '@/status/tool';
import { tools as tasks } from '@/tasks/tool';
import { tools as upgrade } from '@/upgrade/tool';
import { tools as worktree } from '@/worktree/tool';

export const TOOLS: readonly ToolDef[] = [
  ...api,
  ...appstore,
  ...browser,
  ...database,
  ...github,
  ...helpdesk,
  ...home,
  ...knowledge,
  ...media,
  ...reports,
  ...seed,
  ...seo,
  ...slack,
  ...status,
  ...tasks,
  ...upgrade,
  ...worktree
];
