// `pnpm kit:dev-vars`: writes packages/api/.dev.vars for `wrangler dev` with a random TOKEN_PEPPER and a freshly
// generated registry Ed25519 key (JWK). Never overwrites an existing value; .dev.vars is gitignored. LOCAL ONLY.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { devVars, root } from "./lib.mjs";

const p = path.join(root, ".dev.vars");
const have = devVars();
const lines = existsSync(p) ? readFileSync(p, "utf8").replace(/\n*$/, "\n").split("\n").filter((l) => !/^\s*(TOKEN_PEPPER|REGISTRY_SIGNING_KEY)\s*=\s*$/.test(l)) : [];
const add = [];
if (!have.TOKEN_PEPPER) add.push(`TOKEN_PEPPER=${randomBytes(32).toString("hex")}`);
if (!have.REGISTRY_SIGNING_KEY) add.push(`REGISTRY_SIGNING_KEY=${JSON.stringify(generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }))}`);
if (!add.length) {
  console.log(".dev.vars already has TOKEN_PEPPER and REGISTRY_SIGNING_KEY; nothing changed.");
} else {
  writeFileSync(p, `${[...lines.filter(Boolean), ...add].join("\n")}\n`, { mode: 0o600 });
  console.log(`Wrote ${add.map((l) => l.split("=")[0]).join(" and ")} to ${p} (local only, gitignored).`);
}
