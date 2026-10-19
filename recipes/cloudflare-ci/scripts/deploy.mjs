import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function plan(target) {
  if (!["staging", "production"].includes(target)) throw new Error("Target must be staging or production");
  return [
    ["d1", "migrations", "apply", "DB", "--remote", "--env", target],
    ["deploy", "--env", target],
  ];
}
export function preflight(config, credentials) {
  if (!credentials.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{32}$/i.test(credentials.CLOUDFLARE_ACCOUNT_ID ?? "")) throw new Error("Environment token and account ID are required");
  const ids = ["staging", "production"].map((target) => {
    const id = config.env?.[target]?.d1_databases?.find((db) => db.binding === "DB")?.database_id;
    if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id ?? "") || id === "00000000-0000-0000-0000-000000000000") throw new Error(`Provision ${target} DB before deployment`);
    return id;
  });
  if (ids[0] === ids[1]) throw new Error("Staging and production must use different D1 databases");
}
export function execute(target, runner) {
  for (const args of plan(target)) {
    const code = runner(args);
    if (code !== 0) throw new Error(`Wrangler ${args[0]} failed (${code}); remaining steps skipped`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode] = process.argv.slice(2);
  const commands = plan(target);
  if (mode === undefined) console.log(JSON.stringify(commands, null, 2));
  else if (mode === "--execute") {
    const root = fileURLToPath(new URL("../", import.meta.url));
    preflight(JSON.parse(readFileSync(path.join(root, "wrangler.json"), "utf8")), process.env);
    execute(target, (args) => {
      const result = spawnSync(process.execPath, [path.join(root, "node_modules/wrangler/bin/wrangler.js"), ...args], { cwd: root, stdio: "inherit" });
      if (result.error) throw result.error;
      return result.status ?? 1;
    });
  } else throw new Error("Only --execute is supported; omit it to inspect the plan");
}
