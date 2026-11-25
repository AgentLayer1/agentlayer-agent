import { FOLDERS } from '@/config';
import { defineTool, type ToolDef } from '@/shared/tool-def';
import { readProbe } from './probe';
import { packIds, statusOf } from './registry';

export const tools: ToolDef[] = [
  defineTool({
    name: 'packs_status',
    description:
      "Read-only: every optional pack configure-skills can set up, in display order, each with its group, a one-line blurb, the configure section that walks it (`walk`), whether configure can take it out again (`removable`), whether this machine can offer it (`available`), whether setup offers it first (`recommended`), and its `state` in this home: `new`, `partial` (some of it set up; `missing` names what's left) or `ready` (`missing` lists optional parts still off). Reads settings, .mcp.json, home files, the secret store's key NAMES as loaded at boot (a key added since shows after a restart; never a value), and asks the codex and agy CLIs for their version.",
    inputSchema: {},
    handler: async () => {
      const probe = readProbe(FOLDERS.HOME);
      return { packs: packIds().map((id) => statusOf(id, probe)) };
    }
  })
];
