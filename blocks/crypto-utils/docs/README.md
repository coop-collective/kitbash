# crypto-utils

WebCrypto helpers for Cloudflare Workers, as one dependency-free file (`src/lib/crypto-utils/crypto.ts` in a hono-d1 project).

The point of the block is the defaults: secrets are stored as HMACs under a key derived from a pepper (a Worker
secret) per purpose, so a database leak alone is not enough to brute-force short codes; comparisons are constant
time; six-digit codes are uniform (rejection sampling, unlike `% 1_000_000` on a 32-bit value).

Harvested from Ideator (`packages/api/src/util.ts`) and social-connector (`telegram-connector/src/lib/crypto.ts`),
rewritten as one tested module. See `SKILL.md` for the interface.
