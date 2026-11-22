/**
 * The member's Ed25519 publisher key: generated on first publish, stored in the OS keychain (macOS `security`, Linux
 * `secret-tool`) with a file fallback `~/.kit/keys/publisher.json` (0600). `KIT_KEYCHAIN=0` forces the file (tests).
 * Commands run with `execFile` and fixed argv.
 */
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { KitError, generateSigningKeyPair, keyIdOf, publicKeyFromJwk } from "@w3bstack/core";
import { kitHome } from "./config.ts";
import type { Io } from "./io.ts";

const SERVICE = "w3bstack-publisher";
/** The keychain item name before the rename. A key stored there is still this member's publisher identity. */
const LEGACY_SERVICE = "kitbash-publisher";
const ACCOUNT = "default";

export interface PublisherKey {
  publicKey: string;
  keyId: string;
  privateKeyJwk: JsonWebKey;
  store: "keychain" | "file";
}

function spawn(file: string, args: string[], input?: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = execFile(file, args, { timeout: 10_000, shell: false }, (err, stdout) => {
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0, stdout: stdout ?? "" });
    });
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

export interface Backend {
  name: "keychain" | "file";
  load(): Promise<string | null>;
  save(secret: string): Promise<boolean>;
}

type Exec = typeof spawn;

/** Reads the current item first, then the item an earlier release stored; new keys are saved under the current name. */
export function keychainBackend(io: Pick<Io, "env" | "platform">, run: Exec = spawn): Backend | null {
  if (io.env.KIT_KEYCHAIN === "0") return null;
  const first = async (lookup: (service: string) => string[], file: string) => {
    for (const service of [SERVICE, LEGACY_SERVICE]) {
      const r = await run(file, lookup(service));
      if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
    }
    return null;
  };
  if (io.platform === "darwin") {
    return {
      name: "keychain",
      load: () => first((service) => ["find-generic-password", "-a", ACCOUNT, "-s", service, "-w"], "security"),
      // `security` only takes the secret as an argument; it is visible to `ps` for the moment the command runs.
      save: async (secret) => (await run("security", ["add-generic-password", "-U", "-a", ACCOUNT, "-s", SERVICE, "-w", secret])).code === 0,
    };
  }
  if (io.platform === "linux") {
    return {
      name: "keychain",
      load: () => first((service) => ["lookup", "service", service, "account", ACCOUNT], "secret-tool"),
      save: async (secret) => (await run("secret-tool", ["store", "--label=w3bstack publisher key", "service", SERVICE, "account", ACCOUNT], secret)).code === 0,
    };
  }
  return null;
}

function fileBackend(io: Io): Backend {
  const dir = path.join(kitHome(io), "keys");
  const file = path.join(dir, "publisher.json");
  return {
    name: "file",
    load: async () => {
      try {
        return (await readFile(file, "utf8")).trim();
      } catch {
        return null;
      }
    },
    save: async (secret) => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(file, `${secret}\n`, { mode: 0o600 });
      await chmod(file, 0o600);
      return true;
    },
  };
}

async function parse(secret: string, store: Backend["name"]): Promise<PublisherKey> {
  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(secret) as JsonWebKey;
  } catch {
    throw new KitError("signature_invalid", `the stored publisher key (${store}) is not valid JSON`);
  }
  const publicKey = publicKeyFromJwk(jwk);
  return { publicKey, keyId: await keyIdOf(publicKey), privateKeyJwk: jwk, store };
}

/** Loads the publisher key, generating and storing one on first use. */
export async function loadOrCreatePublisherKey(io: Io): Promise<PublisherKey & { created: boolean }> {
  const kc = keychainBackend(io);
  const file = fileBackend(io);
  for (const b of kc ? [kc, file] : [file]) {
    const s = await b.load();
    if (s) return { ...(await parse(s, b.name)), created: false };
  }
  const kp = await generateSigningKeyPair();
  const secret = JSON.stringify(kp.privateKeyJwk);
  let store: Backend["name"] = "file";
  if (kc && (await kc.save(secret))) store = "keychain";
  else await file.save(secret);
  return { publicKey: kp.publicKey, keyId: kp.keyId, privateKeyJwk: kp.privateKeyJwk, store, created: true };
}
