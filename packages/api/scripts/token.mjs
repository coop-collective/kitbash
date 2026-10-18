// `pnpm kit:token [--email you@x] [--label laptop] [--quiet]`: mints a kit_ bearer token for the local owner and prints
// it once. Only its HMAC goes into the LOCAL D1, computed exactly as the email-code-auth block does
// (src/lib/auth/tokens.ts: HMAC-SHA256 under the HKDF "bearer-token/v1" key derived from TOKEN_PEPPER, see
// src/lib/crypto.ts purposeKey). TOKEN_PEPPER comes from .dev.vars (the same value `wrangler dev` uses). Seeds @coop
// first when needed. LOCAL ONLY (--local).
import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { arg, devVars, ensureOwner, migrateLocal, q, sql } from "./lib.mjs";

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
if (pepper.length < 32) {
  console.error("TOKEN_PEPPER must be 32+ characters (the auth block refuses shorter ones): rerun `pnpm kit:dev-vars` after removing it.");
  process.exit(1);
}
// crypto-utils purposeKey(secret, "bearer-token/v1"): HKDF-SHA256, salt "kitbash/crypto-utils", 256-bit HMAC key
const key = Buffer.from(hkdfSync("sha256", pepper, "kitbash/crypto-utils", "bearer-token/v1", 32));
const hash = createHmac("sha256", key).update(token).digest("hex");
const id = `tok_${randomBytes(8).toString("hex")}`;
sql(`INSERT INTO member_tokens (id, member_id, token_hash, label, created_at) VALUES (${q(id)}, ${q(memberId)}, ${q(hash)}, ${q(label)}, ${Date.now()})`);
if (process.argv.includes("--quiet")) process.stdout.write(`${token}\n`);
else console.log(`Token for ${email} (${memberId}), shown once:\n\n  export KIT_TOKEN=${token}\n  export KIT_URL=http://localhost:8787\n`);
