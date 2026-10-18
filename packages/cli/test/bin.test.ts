import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { COMMAND_NAMES } from "../src/cli.ts";
import { here, kit, tmpDir } from "./helpers.ts";

const run = promisify(execFile);
const pkg = path.resolve(here, "..");

describe("the kit executable", () => {
  it("lists every command in --help and exits 2 without a command", async () => {
    const d = await tmpDir();
    const h = await kit(["--help"], { cwd: d });
    expect(h.code).toBe(0);
    for (const c of ["login", "init", "search", "get", "install", "apply", "verify", "upgrade", "diff", "harvest", "validate", "publish", "propose", "status", "heartbeat"]) {
      expect(COMMAND_NAMES).toContain(c);
      expect(h.out).toContain(`kit ${c}`);
    }
    expect((await kit([], { cwd: d })).code).toBe(2);
    const u = await kit(["frobnicate"], { cwd: d });
    expect(u.code).toBe(2);
    expect(u.err).toMatch(/unknown command/);
  });

  it("runs from source with node (type stripping) and from the single-file build", async () => {
    const src = await run(process.execPath, [path.join(pkg, "src", "kit.ts"), "--version"], { cwd: pkg });
    expect(src.stdout.trim()).toBe("kit 0.1.0");
    await run(process.execPath, [path.join(pkg, "scripts", "build.mjs")], { cwd: pkg, timeout: 60_000 });
    const built = await run(process.execPath, [path.join(pkg, "dist", "kit.js"), "validate", path.join(pkg, "..", "core", "test", "fixtures", "blocks", "email-code-auth-fixture")], { cwd: pkg });
    expect(built.stdout).toMatch(/^valid: /);
  }, 60_000);
});
