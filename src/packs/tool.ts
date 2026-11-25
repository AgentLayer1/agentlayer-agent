import { FOLDERS } from '@/config';
import { defineTool, type ToolDef } from '@/shared/tool-def';
import { readProbe } from './probe';
import { packIds, statusOf } from './registry';

export const tools: ToolDef[] = [
  defineTool({
    name: 'packs_status',
    description:
      "Read-only: every optional pack configure-skills can set up, in display order, each with its group, a one-line blurb, the configure section that walks it (`walk`) and the one that removes it (`remove`, null when there's nothing to remove), whether this machine can offer it (`available`), and its `state` in this home: `new`, `partial` (some of it set up; `missing` names what's left) or `ready` (`missing` lists optional parts still off). Reads settings, .mcp.json, home files and the secret store's key NAMES as loaded at boot (a key added since shows after a restart); never a value.",
    inputSchema: {},
    handler: async () => {
      const probe = readProbe(FOLDERS.HOME);
      return { packs: packIds().map((id) => statusOf(id, probe)) };
    }
  })
];
