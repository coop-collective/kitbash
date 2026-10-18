// The registry's co-signing key (REGISTRY_SIGNING_KEY: an Ed25519 private JWK as JSON) and its public half.
import { keyIdOf, publicKeyFromJwk } from "@kitbash/core";
import { ApiError, type Bindings } from "./types";

export interface RegistryKey {
  jwk: JsonWebKey;
  publicKey: string;
  keyId: string;
}

const cache = new Map<string, RegistryKey>();

export async function registryKey(env: Bindings): Promise<RegistryKey> {
  const raw = env.REGISTRY_SIGNING_KEY;
  if (!raw) throw new ApiError("internal", "REGISTRY_SIGNING_KEY is not set (pnpm kit:dev-vars writes one to .dev.vars)");
  const hit = cache.get(raw);
  if (hit) return hit;
  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(raw) as JsonWebKey;
  } catch {
    throw new ApiError("internal", "REGISTRY_SIGNING_KEY is not JSON (expected an Ed25519 private JWK)");
  }
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d || !jwk.x) throw new ApiError("internal", "REGISTRY_SIGNING_KEY is not an Ed25519 private JWK");
  const publicKey = publicKeyFromJwk(jwk);
  const key = { jwk, publicKey, keyId: await keyIdOf(publicKey) };
  cache.set(raw, key);
  return key;
}
