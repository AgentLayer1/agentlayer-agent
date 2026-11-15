import type { ToolDef } from '@/shared/types';
import { tools as reads } from './reads';
import { tools as sweep } from './sweep';
import { tools as writes } from './writes';

export const tools: ToolDef[] = [...reads, ...sweep, ...writes];
