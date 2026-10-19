import { cp, mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
const [run, arm, target] = process.argv.slice(2);
if (
  !run ||
  !["scratch", "library", "reference"].includes(arm) ||
  !target ||
  !/^[a-z0-9-]+$/.test(run)
)
  throw new Error(
    "Usage: node copy-app.mjs RUN_DIRECTORY scratch|library|reference NEW_DESTINATION",
  );
const source = await realpath(
  path.join(import.meta.dirname, "results", run, arm, "app"),
);
const destination = path.resolve(target);
await mkdir(destination, { recursive: false });
await cp(source, destination, {
  recursive: true,
  errorOnExist: true,
  force: false,
});
await writeFile(
  path.join(destination, ".dev.vars"),
  "SESSION_SECRET=local-only-session-secret-at-least-32-characters\nDEMO_PASSWORD=local-demo-password\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    destination,
    note: "Local public demo fixtures only. Run pnpm install, pnpm db:local, pnpm dev. Do not deploy this demo login.",
  }),
);
