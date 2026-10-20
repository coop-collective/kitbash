import { KitError } from "@kitbash/core";
import type { Io } from "../io.ts";

export type GitHost = "local" | "github" | "gitstalk";
export interface RepositoryOptions {
  host: GitHost;
  repo?: string;
  create: boolean;
  visibility: "private" | "public";
  gitstalkUrl: string;
  noGit: boolean;
}

export function httpsOrigin(value: string, flag: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new KitError("invalid_params", `${flag} must be an HTTPS origin`); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new KitError("invalid_params", `${flag} must be an HTTPS origin without credentials, path, or query`);
  }
  return url.origin;
}

export function validateRepository(o: RepositoryOptions): void {
  if (o.repo && !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(o.repo)) throw new KitError("invalid_params", "--repo must be owner/name");
  if (o.host !== "local" && !o.repo) throw new KitError("invalid_params", "--repo owner/name is required for a remote git host");
  if (o.host === "local" && (o.create || o.repo)) throw new KitError("invalid_params", "--repo and --create-repo require --git-host github or gitstalk");
  if (o.noGit && o.host !== "local") throw new KitError("invalid_params", "--no-git cannot be combined with a remote git host");
  httpsOrigin(o.gitstalkUrl, "--gitstalk-url");
}

/** Bootstrap subprocesses are fixed argv; only remote creation receives forge credentials. */
export async function command(io: Io, cwd: string, file: string, args: string[], credentials = false): Promise<void> {
  const env: Record<string, string> = { PATH: io.env.PATH ?? "", HOME: io.home, NO_COLOR: "1", CI: "1", GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["SystemRoot", "USERPROFILE", "TMPDIR", ...(credentials ? ["GH_TOKEN", "GITHUB_TOKEN", "GH_HOST", "GH_CONFIG_DIR"] : [])]) {
    if (io.env[key]) env[key] = io.env[key]!;
  }
  const result = await io.runner(file, args, { cwd, env, timeoutMs: file === "pnpm" ? 600_000 : 60_000 });
  if (result.exit !== 0) throw new KitError("invalid_params", `${file} ${args[0]} failed (exit ${result.exit}). Generated files remain at ${cwd}; rerun that command there after resolving its prerequisites.`);
}

export async function setupRepository(io: Io, cwd: string, o: RepositoryOptions): Promise<{ host: GitHost; created: boolean; remote?: string }> {
  if (o.noGit) return { host: o.host, created: false };
  await command(io, cwd, "git", ["init", "--initial-branch=main"]);
  if (o.host === "local") return { host: o.host, created: false };
  const remote = o.host === "github" ? `https://github.com/${o.repo}.git` : `${o.gitstalkUrl}/${o.repo}.git`;
  if (o.create && o.host === "github") {
    await command(io, cwd, "gh", ["repo", "create", o.repo!, `--${o.visibility}`, "--source", ".", "--remote", "origin"], true);
  } else {
    if (o.create) {
      const token = io.env.GITSTALK_TOKEN;
      if (!token) throw new KitError("unauthorized", "GITSTALK_TOKEN with create scope is required. Local project retained; authenticate before creating the Gitstalk repository.");
      const [owner, name] = o.repo!.split("/");
      let response: Response;
      try {
        response = await io.fetch(`${o.gitstalkUrl}/api/repos`, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ owner, name, visibility: o.visibility, start: "empty" }),
        });
      } catch { throw new KitError("invalid_params", "Gitstalk repository creation failed; local files retained. Check connectivity and repository status before retrying."); }
      if (!response.ok) throw new KitError("invalid_params", `Gitstalk repository creation returned HTTP ${response.status}; local files retained. No existing repository was adopted.`);
    }
    await command(io, cwd, "git", ["remote", "add", "origin", remote]);
  }
  return { host: o.host, created: o.create, remote };
}
