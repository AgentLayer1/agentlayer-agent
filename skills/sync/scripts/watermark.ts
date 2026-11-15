#!/usr/bin/env bun
import { stampCadence } from "../../../src/shared/cadence";
import { agentHomePath, isAgentHome } from "../../../src/shared/env";

/**
 * Stamp a cadence watermark: `bun watermark.ts <key> <YYYY-MM-DD>` (`goals-week`,
 * `goals-month`, `goals-year`). Written by the goals playbooks once goals are saved; read by
 * cadence.ts (same dir). Read-modify-write preserves sibling watermarks.
 */

const [key, date] = process.argv.slice(2);
if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("usage: watermark.ts <key> <YYYY-MM-DD>");
  process.exit(1);
}

const home = agentHomePath();
if (!isAgentHome(home)) {
  console.error(`not an agent home: ${home} — set AGENT_HOME`);
  process.exit(1);
}

try {
  stampCadence(key, date);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
