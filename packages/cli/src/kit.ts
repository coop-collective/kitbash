/** The `kit` executable: wires the real process environment into `run()`. */
import os from "node:os";
import { run } from "./cli.ts";
import { execRunner } from "./verify.ts";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return new Promise((resolve) => {
      let buf = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (d) => {
        buf += d;
        if (buf.includes("\n")) {
          process.stdin.pause();
          resolve(buf.split("\n")[0]!);
        }
      });
      process.stdin.on("end", () => resolve(buf));
    });
  }
  let buf = "";
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

const code = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  home: os.homedir(),
  fetch: globalThis.fetch,
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  readStdin,
  now: () => new Date().toISOString(),
  runner: execRunner,
  platform: process.platform,
});
process.exitCode = code;
