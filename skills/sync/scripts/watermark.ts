#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirOf } from "../../../src/shared/naming";
import { agentHomePath, isAgentHome } from "../../../src/shared/env";
import { writeJsonAtomic } from "../../../src/shared/utils";

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

const file = join(dataDirOf(home), "cadence.json");
// A file that won't parse is left for the operator rather than replaced, which would lose its other watermarks.
const readJson = (): Record<string, string> => {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch {
    console.error(`${file} is not valid JSON; fix or remove it, then stamp again`);
    process.exit(1);
  }
};
writeJsonAtomic(file, { ...readJson(), [key]: date });
