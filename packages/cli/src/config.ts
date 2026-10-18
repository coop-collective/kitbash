/**
 * User-level state: `~/.kit/credentials` (0600, JSON) and the registry settings. `KIT_TOKEN` wins over the file,
 * `KIT_API_URL` over the stored URL, `KIT_REGISTRY_PUBLIC_KEY` over the pinned key. `KIT_HOME` relocates `~/.kit`.
 */
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { KitError } from "@kitbash/core";
import type { Io } from "./io.ts";

export const DEFAULT_API_URL = "http://127.0.0.1:8787";

export interface Credentials {
  api_url?: string;
  token?: string;
  /** The registry's Ed25519 co-signing key (`ed25519:…`), pinned at `kit login`. */
  registry_public_key?: string;
  /** Default scope for `kit publish` (from `/api/me`). */
  scope?: string;
  member?: string;
}

export function kitHome(io: Io): string {
  return io.env.KIT_HOME ? path.resolve(io.cwd, io.env.KIT_HOME) : path.join(io.home, ".kit");
}

export function credentialsPath(io: Io): string {
  return path.join(kitHome(io), "credentials");
}

export async function readCredentials(io: Io): Promise<Credentials> {
  const p = credentialsPath(io);
  let text: string;
  try {
    text = await readFile(p, "utf8");
  } catch {
    return {};
  }
  try {
    const st = await stat(p);
    if (io.platform !== "win32" && (st.mode & 0o077) !== 0) io.err(`warning: ${p} is readable by others; run chmod 600 ${p}\n`);
  } catch {
    /* ignore */
  }
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Credentials) : {};
  } catch {
    throw new KitError("invalid_params", `${p} is not valid JSON; run kit login again`);
  }
}

/** Writes the credentials file atomically with mode 0600 (the directory 0700). */
export async function writeCredentials(io: Io, creds: Credentials): Promise<string> {
  const dir = kitHome(io);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const p = credentialsPath(io);
  const tmp = `${p}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, p);
  return p;
}

export interface Settings {
  apiUrl: string;
  token: string | undefined;
  registryPublicKey: string | undefined;
  scope: string | undefined;
}

export async function loadSettings(io: Io): Promise<Settings> {
  const c = await readCredentials(io);
  return {
    apiUrl: (io.env.KIT_API_URL || c.api_url || DEFAULT_API_URL).replace(/\/+$/, ""),
    token: io.env.KIT_TOKEN || c.token,
    registryPublicKey: io.env.KIT_REGISTRY_PUBLIC_KEY || c.registry_public_key,
    scope: io.env.KIT_SCOPE || c.scope,
  };
}
