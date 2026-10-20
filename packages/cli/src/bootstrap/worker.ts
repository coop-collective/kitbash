import { readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { parseJsonc, renderTemplate, type Lock, type ProjectProfile } from "@kitbash/core";

/** Bindings and vars do not inherit into Wrangler environments. Keep every target explicit. */
export async function configureWorker(root: string, profile: ProjectProfile, name: string, lock: Lock, hostname?: string): Promise<void> {
  if (!profile.config?.wrangler) return;
  const configPath = path.join(root, profile.config.wrangler);
  const config = parseJsonc(await readFile(configPath, "utf8")) as Record<string, any>;
  config.env ??= {};
  for (const target of ["staging", "production"]) {
    const env = config.env[target] ??= { name: `${name}-${target}` };
    env.vars = { ...(config.vars ?? {}), ...(env.vars ?? {}) };
    for (const key of ["d1_databases", "kv_namespaces", "r2_buckets", "send_email"]) {
      if (!Array.isArray(config[key])) continue;
      const existing = env[key] ??= [];
      for (const source of config[key]) {
        const binding = source.binding ?? source.name;
        if (existing.some((entry: Record<string, string>) => (entry.binding ?? entry.name) === binding)) continue;
        const resource = { ...source };
        if (key === "d1_databases") {
          resource.database_name = `${name}-${target}-${binding.toLowerCase().replaceAll("_", "-")}`;
          resource.database_id = "00000000-0000-0000-0000-000000000000";
        }
        if (key === "kv_namespaces") resource.id = "REPLACE_ME";
        if (key === "r2_buckets") resource.bucket_name = `${name}-${target}-${binding.toLowerCase().replaceAll("_", "-")}`;
        delete resource.preview_id;
        delete resource.preview_database_id;
        delete resource.preview_bucket_name;
        existing.push(resource);
      }
    }
    if (config.durable_objects) env.durable_objects = structuredClone(config.durable_objects);
  }
  if (hostname) config.env.production.routes = [{ pattern: hostname, custom_domain: true }];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  // Named DO exports are required for the Worker to build, even before routes are mounted.
  if (profile.stack.framework !== "hono" || !config.durable_objects?.bindings?.length) return;
  const main = config.main as string;
  const exports: string[] = [];
  for (const [id, entry] of Object.entries(lock.blocks)) {
    const block = id.split("/")[1]!;
    const manifest = JSON.parse(await readFile(path.join(root, ".kit/catalog/blocks", block, "block.json"), "utf8"));
    for (const exported of manifest.exports ?? []) {
      if (exported.kind !== "durable-object") continue;
      const symbol = renderTemplate(exported.symbol, { params: entry.params, paths: profile.paths });
      if (!config.durable_objects.bindings.some((binding: Record<string, string>) => binding.class_name === symbol)) continue;
      const file = entry.files.find(file => file.block_path === exported.from || file.block_path.endsWith(`/${exported.from}`));
      if (!file) continue;
      let modulePath = path.posix.relative(path.posix.dirname(main), file.target).replace(/\.ts$/, "");
      if (!modulePath.startsWith(".")) modulePath = `./${modulePath}`;
      exports.push(`export { ${symbol} } from ${JSON.stringify(modulePath)};`);
    }
  }
  if (exports.length) await appendFile(path.join(root, main), `\n${exports.join("\n")}\n`);
}
