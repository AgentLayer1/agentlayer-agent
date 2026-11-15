import type { ToolDef } from '@/shared/tool-def';
import { tools as flows } from './flows';
import { tools as page } from './page';
import { tools as webSearch } from './web-search';

export const tools: ToolDef[] = [...page, ...flows, ...webSearch];
