import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { selectSecrets, selectTarget, withSecretsFile } from "./secrets.mjs";

export function plan(target, secretsFile) {
  if (!["staging", "production"].includes(target)) throw new Error("Target must be staging or production");
  return [
    ["d1", "migrations", "apply", "DB", "--remote", "--env", target],
    ["deploy", ...(secretsFile ? ["--secrets-file", secretsFile] : []), "--env", target],
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
export function execute(target, runner, secretsFile) {
  for (const args of plan(target, secretsFile)) {
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
    const secretConfig = JSON.parse(readFileSync(path.join(root, ".kitbash/secrets.json"), "utf8"));
    selectTarget(secretConfig, target);
    withSecretsFile(selectSecrets(secretConfig, process.env), (secretsFile) => {
      execute(target, (args) => {
        const result = spawnSync(process.execPath, [path.join(root, "node_modules/wrangler/bin/wrangler.js"), ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
        // Wrangler diagnostics can include values. Do not forward captured output.
        if (result.error) throw new Error("Unable to run Wrangler; diagnostic values omitted");
        return result.status ?? 1;
      }, secretsFile);
    });
  } else throw new Error("Only --execute is supported; omit it to inspect the plan");
}
