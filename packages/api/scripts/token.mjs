// `pnpm kit:token [--email you@x] [--label laptop] [--quiet]`: mints a kit_ bearer token for the local owner and prints
// it once. Only HMAC-SHA256(TOKEN_PEPPER, token) goes into the LOCAL D1; TOKEN_PEPPER comes from .dev.vars (the same
// value `wrangler dev` uses). Seeds @coop first when needed. LOCAL ONLY (--local).
import { createHmac, randomBytes } from "node:crypto";
import { arg, devVars, ensureOwner, migrateLocal, now, q, sql } from "./lib.mjs";

const pepper = process.env.TOKEN_PEPPER ?? devVars().TOKEN_PEPPER;
if (!pepper) {
  console.error("TOKEN_PEPPER is not set: run `pnpm kit:dev-vars` (writes packages/api/.dev.vars) first.");
  process.exit(1);
}
const email = arg("email", process.env.KIT_DEV_EMAIL ?? "coop@kit.local");
const label = arg("label", "dev token");
migrateLocal();
const { memberId } = ensureOwner({ slug: arg("slug", "coop"), email, name: arg("name", "Coop") });
const token = `kit_${randomBytes(32).toString("base64url")}`;
const hash = createHmac("sha256", pepper).update(token).digest("hex");
const id = `tok_${randomBytes(8).toString("hex")}`;
sql(`INSERT INTO member_tokens (id, member_id, token_hash, label, created_at) VALUES (${q(id)}, ${q(memberId)}, ${q(hash)}, ${q(label)}, ${q(now())})`);
if (process.argv.includes("--quiet")) process.stdout.write(`${token}\n`);
else console.log(`Token for ${email} (${memberId}), shown once:\n\n  export KIT_TOKEN=${token}\n  export KIT_URL=http://localhost:8787\n`);
