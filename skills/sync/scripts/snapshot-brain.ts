#!/usr/bin/env bun
import { agentHomePath, isAgentHome } from "../../../src/shared/env";
import { SyncKind, takeSyncLock } from "../../../src/shared/sync-lock";
import { commitBrain } from "./commit-brain";

/**
 * Sync's first step. It takes the home's sync lock, so a second sync or a brain refresh can't run beside this one,
 * then commits whatever the home holds before the run as one commit, under the same guards as commit-brain.ts, so
 * the run's own changes land as a clean diff and the snapshot is a restore point if the run goes wrong. A script of
 * its own so the sync band can tell it from the closing commit.
 *
 * Usage: bun snapshot-brain.ts [--refresh] [--take-over] — prints a single JSON result for the skill to render:
 * `SYNC_RUNNING` with the holder when another run has the lock, otherwise the snapshot's result and the `lock` token
 * the closing commit-brain.ts releases.
 */
if (import.meta.main) {
  const home = agentHomePath();
  if (!isAgentHome(home)) {
    console.error(`not an agent home: ${home} — set AGENT_HOME`);
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const kind = args.includes("--refresh") ? SyncKind.Refresh : SyncKind.Sync;
  const lock = takeSyncLock(kind, { takeOver: args.includes("--take-over") });
  console.log(
    JSON.stringify(
      lock.taken
        ? { ...commitBrain(home, { start: true }), lock: lock.token }
        : { status: "SYNC_RUNNING", holder: lock.holder },
    ),
  );
}
