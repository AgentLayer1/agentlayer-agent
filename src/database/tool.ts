import type { ToolDef } from '@/shared/tool-def';
import { tools as fork } from './fork';
import { tools as query } from './query';

export const tools: ToolDef[] = [...query, ...fork];
