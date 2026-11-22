import type { Register } from 'claude-code';

import { registerAgents } from '../agents/agents';
import { registerCommands } from '../commands/commands';
import { registerManuals } from '../manuals/manuals';
import { registerNotices } from '../notices/notices';
import { registerHeartbeat } from '../heartbeat/heartbeat';
import { registerQueue } from '../queue/queue';
import { registerReports } from '../reports/reports';
import { registerSetup } from '../setup/setup';
import { registerSidebar } from '../sidebar/sidebar';
import { registerSync } from '../sync/tracker';
import { registerTasks } from '../tasks/tasks';

export const register: Register = (on) => {
  registerManuals(on);
  registerReports(on);
  registerSync(on);
  registerCommands(on);
  registerTasks(on);
  registerNotices(on);
  registerQueue(on);
  registerHeartbeat(on);
  registerSetup(on);
  registerAgents(on);
  registerSidebar(on);
};
