import type { ToolDef } from '@/shared/types';
import { tools as openPageRank } from './open-page-rank';
import { tools as pageSpeed } from './page-speed';
import { tools as searchConsole } from './search-console';
import { tools as serpapi } from './serpapi';

export const tools: ToolDef[] = [...searchConsole, ...pageSpeed, ...serpapi, ...openPageRank];
