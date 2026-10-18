// `pnpm kit:seed [--slug coop] [--email you@x] [--name Coop]`: applies the migrations to the LOCAL D1 and creates the
// MVP's one personal org (@coop) with its owner. Idempotent. LOCAL ONLY (--local).
import { arg, ensureOwner, migrateLocal } from "./lib.mjs";

const slug = arg("slug", "coop");
const email = arg("email", process.env.KIT_DEV_EMAIL ?? "coop@kit.local");
const name = arg("name", "Coop");
migrateLocal();
const { orgId, memberId } = ensureOwner({ slug, email, name });
console.log(`Seeded @${slug} (${orgId}) with owner ${email} (${memberId}). Next: pnpm kit:token`);
