#!/usr/bin/env node
import { loadKit } from "./load-kit.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: secrets.mjs <setup|status|presence|generate|provision-github|provision-github-app|provision-worker-sync> <project-alias> <local|staging|production> [registered-secret-name]. setup generates allowed keys and registers configured access in one call. Requires an operator-configured broker; returns metadata only.");
} else {
  try {
    if (args.length < 3 || args.length > 4) throw new Error();
    const [operation, project, target, name] = args;
    const kit = await loadKit();
    const result = await kit.runSecrets({ operation, project, target, ...(name === undefined ? {} : { name }) });
    console.log(JSON.stringify(result));
  } catch {
    // The launcher also covers failures in module loading; no exception text reaches stdout/stderr.
    console.error(JSON.stringify({ error: { code: "unavailable", message: "Secrets operation was not confirmed. Check the configured broker and its audit status; input and provider details were omitted." } }));
    process.exitCode = 1;
  }
}
