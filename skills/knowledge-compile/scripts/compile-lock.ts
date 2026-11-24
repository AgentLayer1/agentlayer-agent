#!/usr/bin/env bun
import { agentHomePath, isAgentHome } from "../../../src/shared/env";
import { releaseSyncLock, SyncKind, takeSyncLock } from "../../../src/shared/sync-lock";
import { flagOf } from "../../../src/shared/utils";

/**
 * The home's sync lock around a compile run, so a compile never runs beside a sync, a brain refresh or another compile.
 *
 * Usage: bun compile-lock.ts take [--take-over] | release --token=<lock> — prints one JSON result:
 * `{ lock }` or `{ status: "SYNC_RUNNING", holder }` for take, `{ released }` for release.
 */
if (import.meta.main) {
  const home = agentHomePath();
  if (!isAgentHome(home)) {
    console.error(`not an agent home: ${home} — set AGENT_HOME`);
    process.exit(1);
  }
  const [verb, ...args] = process.argv.slice(2);
  const token = flagOf(args, "token");
  if (verb === "take") {
    const lock = takeSyncLock(SyncKind.Compile, { takeOver: args.includes("--take-over") });
    console.log(JSON.stringify(lock.taken ? { lock: lock.token } : { status: "SYNC_RUNNING", holder: lock.holder }));
  } else if (verb === "release" && token) {
    console.log(JSON.stringify({ released: releaseSyncLock(token) }));
  } else {
    console.error("usage: bun compile-lock.ts take [--take-over] | release --token=<lock>");
    process.exit(1);
  }
}
