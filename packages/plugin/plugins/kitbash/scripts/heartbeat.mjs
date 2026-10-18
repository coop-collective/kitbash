// SessionStart hook body: `kit heartbeat --quiet` (the lock's block list only, and only with telemetry on). Never
// throws, never prints: a hook must not disturb the session.
import { run } from "@kitbash/cli";
import { makeIo } from "./server.mjs";

export async function heartbeat(opts = {}) {
  try {
    const { io } = makeIo(opts);
    return await run(["heartbeat", "--quiet"], io);
  } catch {
    return 0;
  }
}
