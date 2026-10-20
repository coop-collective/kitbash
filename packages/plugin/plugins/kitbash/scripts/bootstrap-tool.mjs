import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { run } from "@kitbash/cli";

export const BOOTSTRAP_TOOL = {
  name: "kitbash_bootstrap",
  description: "List bundled project presets and compatible blocks, or create a new local Worker, vinext or Rust server project with selected blocks. Remote repository creation and dependency installation require explicit options. Does not deploy the app or provision production resources.",
  input: z.strictObject({
    list: z.boolean().default(false),
    directory: z.string().min(1).optional(),
    preset: z.enum(["worker", "vinext", "rust-server"]).optional(),
    blocks: z.array(z.string().min(1).regex(/^[^,\r\n]+$/)).default([]),
    git_host: z.enum(["local", "github", "gitstalk"]).default("local"),
    repo: z.string().min(1).optional(),
    gitstalk_url: z.string().url().optional(),
    visibility: z.enum(["private", "public"]).default("private"),
    hostname: z.string().min(1).optional(),
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    create_repo: z.boolean().default(false),
    install: z.boolean().default(false),
    no_git: z.boolean().default(false),
    params: z.record(z.string(), z.string()).optional(),
    infisical_project: z.string().min(1).optional(),
    infisical_domain: z.string().min(1).optional(),
  }).superRefine((args, ctx) => {
    if (!args.list && (!args.directory || !args.preset)) {
      ctx.addIssue({ code: "custom", message: "directory and preset are required unless list is true" });
    }
    if (args.create_repo && (args.git_host === "local" || !args.repo || args.no_git)) {
      ctx.addIssue({ code: "custom", message: "create_repo requires a remote git_host, repo and git initialization" });
    }
    if (args.list && (args.create_repo || args.install)) {
      ctx.addIssue({ code: "custom", message: "list cannot create a repository or install dependencies" });
    }
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
};

// Resolve from the bundle location, not the consuming project's working directory.
export function catalogEnv(env) {
  if (env.KIT_CATALOG_ROOT) return env;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    for (const candidate of [path.join(dir, "catalog"), dir]) {
      if (fs.existsSync(path.join(candidate, "bootstraps", "worker", "bootstrap.json"))) return { ...env, KIT_CATALOG_ROOT: candidate };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return env;
    dir = parent;
  }
}

export function runBootstrap(argv, io) {
  return run(["bootstrap", ...argv], { ...io, env: catalogEnv(io.env) });
}
