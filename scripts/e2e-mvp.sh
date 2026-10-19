#!/usr/bin/env bash
# The MVP exit, end to end and LOCAL ONLY (PLAN.md WP-08, DESIGN §7):
#
#   1. boots kit-api with `wrangler dev` on 127.0.0.1 (isolated state, throwaway pepper and registry key in a temp env
#      file; nothing under packages/api is written), seeds @coop and mints an owner token;
#   2. `kit login` (temp KIT_HOME) and `kit publish` of every blocks/* (private, dependencies first);
#   3. copies templates/hono-d1 to a temp dir, installs its npm dependencies, commits a git baseline;
#   4. runs a headless Claude Code session with the kitbash plugin and the prompt "add email-code sign-in, CLI OAuth
#      login and orgs using the registry" (time- and budget-capped, push/deploy forbidden);
#   5. asserts the lock has the three blocks, runs `kit verify` for each, and counts the agent's edits outside block
#      files (≤ 3);
#   6. optionally repeats 3-5 with Codex (--codex).
#
# Usage: scripts/e2e-mvp.sh [--no-agent] [--codex] [--serve] [--keep]
#   --no-agent  stop after publishing and a scripted `kit install` of the three blocks (no model calls)
#   --codex     also run the Codex repeat (needs `codex` signed in)
#   --serve     after publishing, print the environment and keep the registry running until Ctrl-C
#   --keep      keep the work directory
# Env: KIT_E2E_PORT (8799), KIT_E2E_BUDGET_USD (5), KIT_E2E_TIMEOUT_S (1800), KIT_E2E_MODEL (Claude Code's default).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$REPO/packages/api"
KIT=(node "$REPO/packages/cli/src/kit.ts")
PORT="${KIT_E2E_PORT:-8799}"
BUDGET="${KIT_E2E_BUDGET_USD:-5}"
TIMEOUT_S="${KIT_E2E_TIMEOUT_S:-1800}"
AGENT=1 CODEX=0 SERVE=0 KEEP=0
for a in "$@"; do
  case "$a" in
    --no-agent) AGENT=0 ;;
    --codex) CODEX=1 ;;
    --serve) SERVE=1 ;;
    --keep) KEEP=1 ;;
    *) echo "unknown flag $a" >&2; exit 2 ;;
  esac
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kitbash-mvp.XXXXXX")"
export KIT_PERSIST="$WORK/state" KIT_HOME="$WORK/kit-home" KIT_KEYCHAIN=0 WRANGLER_SEND_METRICS=false
export KIT_API_URL="http://127.0.0.1:$PORT"
mkdir -p "$KIT_PERSIST" "$KIT_HOME"
log() { printf '\n== %s\n' "$*"; }
# `timeout` is not on stock macOS: SIGALRM through perl's exec keeps the same pid and kills the command at the deadline
with_timeout() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$s" "$@"; }
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  if [ "$KEEP" = 1 ]; then echo "kept $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

# ---------------------------------------------------------------- 1. the registry on wrangler dev
log "registry: wrangler dev on $KIT_API_URL (state $KIT_PERSIST)"
ENV_FILE="$WORK/registry.env"
node -e '
  const { generateKeyPairSync, randomBytes } = require("node:crypto");
  const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  process.stdout.write(`TOKEN_PEPPER=${randomBytes(32).toString("hex")}\nREGISTRY_SIGNING_KEY=${JSON.stringify(jwk)}\n`);
' > "$ENV_FILE"
chmod 600 "$ENV_FILE"
TOKEN_PEPPER="$(sed -n 's/^TOKEN_PEPPER=//p' "$ENV_FILE")"
(cd "$API" && node scripts/seed.mjs >/dev/null)
TOKEN="$(cd "$API" && TOKEN_PEPPER="$TOKEN_PEPPER" node scripts/token.mjs --quiet --label e2e-mvp)"
(cd "$API" && exec npx wrangler dev --ip 127.0.0.1 --port "$PORT" --persist-to "$KIT_PERSIST" --env-file "$ENV_FILE" --show-interactive-dev-session=false >"$WORK/wrangler.log" 2>&1) &
SERVER_PID=$!
for _ in $(seq 1 120); do
  curl -fsS "$KIT_API_URL/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "$KIT_API_URL/health" >/dev/null || { tail -40 "$WORK/wrangler.log"; echo "the registry did not come up" >&2; exit 1; }

# ---------------------------------------------------------------- 2. login and publish every block
log "kit login, kit publish blocks/*"
"${KIT[@]}" login --token "$TOKEN" --api "$KIT_API_URL" >/dev/null
ORDER=(crypto-utils cf-email-sender email-code-auth cli-oauth-login orgs-roles-invites d1-rate-limit api-keys vitest-workerd-harness)
for b in "${ORDER[@]}" $(cd "$REPO/blocks" && ls); do
  case " ${PUBLISHED:-} " in *" $b "*) continue ;; esac
  [ -f "$REPO/blocks/$b/block.json" ] || continue
  "${KIT[@]}" publish "$REPO/blocks/$b" --visibility private | grep -E '^published|error' || { echo "publish $b failed" >&2; exit 1; }
  PUBLISHED="${PUBLISHED:-} $b"
done
"${KIT[@]}" search "email code sign-in" | head -5

if [ "$SERVE" = 1 ]; then
  log "serving; in another shell:"
  echo "  export KIT_HOME=$KIT_HOME KIT_KEYCHAIN=0 KIT_API_URL=$KIT_API_URL"
  echo "  node $REPO/packages/cli/src/kit.ts install @coop/email-code-auth   # dry run"
  echo "(Ctrl-C stops the registry)"
  wait "$SERVER_PID"
  exit 0
fi

# ---------------------------------------------------------------- 3. a fresh project
# Each copy has local allowBuilds config. Every install must succeed, including an
# immutable reinstall of the generated/updated lockfile. Only a missing offline package allows online fallback.
pnpm_install() { # $1: dir
  local missing='const p=require(process.argv[1]+"/package.json");const fs=require("node:fs");process.exit(Object.keys({...p.dependencies,...p.devDependencies}).every((n)=>fs.existsSync(`${process.argv[1]}/node_modules/${n}/package.json`))?0:1)'
  if ! (cd "$1" && CI=1 pnpm install --no-frozen-lockfile --offline >"$WORK/pnpm.log" 2>&1); then
    if ! grep -Eq 'ERR_PNPM_NO_OFFLINE_(META|TARBALL)([^A-Z_]|$)' "$WORK/pnpm.log"; then
      tail -20 "$WORK/pnpm.log"; echo "pnpm install failed in $1" >&2; return 1
    fi
    (cd "$1" && CI=1 pnpm install --no-frozen-lockfile >>"$WORK/pnpm.log" 2>&1) || { tail -20 "$WORK/pnpm.log"; echo "pnpm install failed in $1" >&2; return 1; }
  fi
  (cd "$1" && CI=1 pnpm install --offline --frozen-lockfile >>"$WORK/pnpm.log" 2>&1) || { tail -20 "$WORK/pnpm.log"; echo "frozen pnpm install failed in $1" >&2; return 1; }
  node -e "$missing" "$1" || { tail -20 "$WORK/pnpm.log"; echo "pnpm install left dependencies missing in $1" >&2; return 1; }
}

fresh_project() { # $1: dir
  mkdir -p "$1"
  (cd "$REPO/templates/hono-d1" && tar --exclude node_modules --exclude .wrangler --exclude dist -cf - .) | (cd "$1" && tar -xf -)
  pnpm_install "$1"
  (cd "$1" && git init -q && git add -A && git -c user.email=e2e@kit.local -c user.name=e2e commit -qm baseline)
}

# Files the blocks own (the lock's files) or kit patches (config, package.json), and kit's own state.
count_edits() { # $1: project dir → prints "N files: a b c"
  node - "$1" <<'EOF'
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const dir = process.argv[2];
const lock = JSON.parse(fs.readFileSync(`${dir}/.kit/lock.json`, "utf8"));
const owned = new Set(Object.values(lock.blocks).flatMap((b) => b.files.map((f) => f.target)));
const kitPatched = new Set(["wrangler.jsonc", ".dev.vars.example", "package.json", "pnpm-lock.yaml", "worker-configuration.d.ts"]);
const changed = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" })
  .split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ""));
const edits = changed.filter((p) => !owned.has(p) && !kitPatched.has(p) && !p.startsWith(".kit/") && !p.startsWith("node_modules/") && !p.startsWith(".wrangler/"));
console.log(`${edits.length} ${edits.join(" ")}`);
EOF
}

check_project() { # $1: project dir, $2: label
  local d="$1" ok=1
  log "$2: lock and kit verify"
  [ -f "$d/.kit/lock.json" ] || { echo "no .kit/lock.json: nothing was installed"; echo "$2: MVP EXIT NOT MET"; return 1; }
  for b in email-code-auth cli-oauth-login orgs-roles-invites; do
    if ! node -e 'const l=require(process.argv[1]); process.exit(Object.keys(l.blocks).some((k)=>k.endsWith("/"+process.argv[2]))?0:1)' "$d/.kit/lock.json" "$b"; then
      echo "MISSING from the lock: $b"; ok=0
    fi
  done
  (cd "$d" && npx wrangler types --strict-vars=false >/dev/null 2>&1 || true)
  for id in $(node -e 'console.log(Object.keys(require(process.argv[1]).blocks).join(" "))' "$d/.kit/lock.json"); do
    if (cd "$d" && "${KIT[@]}" verify "$id" --timeout 600 > "$WORK/verify-$(basename "$d")-${id//\//_}.log" 2>&1); then echo "verify $id: PASS"
    else echo "verify $id: FAIL (see $WORK/verify-$(basename "$d")-${id//\//_}.log)"; tail -20 "$WORK/verify-$(basename "$d")-${id//\//_}.log"; ok=0; fi
  done
  read -r n files <<<"$(count_edits "$d")"
  echo "edits outside block files: $n ${files:-}"
  [ "$n" -le 3 ] || ok=0
  [ "$ok" = 1 ] && echo "$2: MVP EXIT MET" || echo "$2: MVP EXIT NOT MET"
  return $((1 - ok))
}

PROMPT='Add email-code sign-in, CLI OAuth login and orgs to this Hono + D1 Worker using the registry (the kitbash registry_* tools): search, get, install the blocks (dry run first, then apply), install npm dependencies if a plan adds any, do each block'"'"'s required adapt steps in src/index.ts, and run registry_verify for every installed block until they pass. Work only inside this directory. Never push, deploy, publish, or call wrangler deploy/secret/kv/d1 against Cloudflare.'

STATUS=0
if [ "$AGENT" = 0 ]; then
  P="$WORK/scripted"; fresh_project "$P"
  log "scripted install (no agent) into $P"
  for b in email-code-auth cli-oauth-login orgs-roles-invites; do
    (cd "$P" && "${KIT[@]}" install "@coop/$b" --apply > "$WORK/install-$b.log" 2>&1) || { tail -30 "$WORK/install-$b.log"; exit 1; }
    grep -E '^(Installed dependency|Applied)' "$WORK/install-$b.log"
  done
  pnpm_install "$P"
  check_project "$P" "scripted" || STATUS=1
else
  # ---------------------------------------------------------------- 4. Claude Code, headless
  P="$WORK/claude"; fresh_project "$P"
  log "Claude Code (headless, plugin from packages/plugin, budget \$$BUDGET, ${TIMEOUT_S}s) in $P"
  START=$(date +%s)
  (cd "$P" && with_timeout "$TIMEOUT_S" claude -p "$PROMPT" \
      --plugin-dir "$REPO/packages/plugin/plugins/kitbash" \
      --output-format stream-json --verbose \
      --max-budget-usd "$BUDGET" \
      ${KIT_E2E_MODEL:+--model "$KIT_E2E_MODEL"} \
      --setting-sources project,local \
      --permission-mode acceptEdits \
      --allowedTools mcp__plugin_kit_kitbash Read Edit Write MultiEdit Glob Grep TodoWrite \
        "Bash(pnpm install:*)" "Bash(pnpm test:*)" "Bash(pnpm typecheck:*)" "Bash(npx vitest:*)" "Bash(npx tsc:*)" \
        "Bash(npx wrangler types:*)" "Bash(ls:*)" "Bash(cat:*)" \
      --disallowedTools "Bash(git push:*)" "Bash(wrangler deploy:*)" "Bash(npx wrangler deploy:*)" "Bash(*deploy*)" \
        "Bash(npm publish:*)" "Bash(pnpm publish:*)" "Bash(curl:*)" "WebFetch" "WebSearch" \
      > "$WORK/claude.jsonl" 2> "$WORK/claude.err") || echo "claude exited $?"
  END=$(date +%s)
  node - "$WORK/claude.jsonl" "$P" $((END - START)) <<'EOF' | tee "$WORK/claude-summary.txt"
const fs = require("node:fs");
const [file, proj, secs] = process.argv.slice(2);
const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const result = lines.findLast((l) => l.type === "result") ?? {};
const tools = {};
const edits = [];
for (const l of lines) for (const c of l.message?.content ?? []) if (c.type === "tool_use") {
  tools[c.name] = (tools[c.name] ?? 0) + 1;
  if (/^(Edit|Write|MultiEdit)$/.test(c.name)) edits.push(String(c.input?.file_path ?? "").replace(`${fs.realpathSync(proj)}/`, "").replace(`${proj}/`, ""));
}
const u = result.usage ?? {};
console.log(JSON.stringify({
  wall_seconds: Number(secs), duration_ms: result.duration_ms, num_turns: result.num_turns, is_error: result.is_error, subtype: result.subtype,
  total_cost_usd: result.total_cost_usd,
  tokens: { input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read_input_tokens, cache_creation: u.cache_creation_input_tokens },
  tool_calls: tools, edit_calls: edits,
}, null, 2));
EOF
  check_project "$P" "claude-code" || STATUS=1
fi

# ---------------------------------------------------------------- 6. Codex (optional)
if [ "$CODEX" = 1 ]; then
  if ! command -v codex >/dev/null; then echo "codex not installed: Codex repeat skipped"
  else
    P="$WORK/codex"; fresh_project "$P"
    log "Codex (exec, workspace-write sandbox) in $P"
    START=$(date +%s)
    (cd "$P" && with_timeout "$TIMEOUT_S" codex exec --json --sandbox workspace-write --skip-git-repo-check \
        -c "mcp_servers.kitbash.command=\"node\"" -c "mcp_servers.kitbash.args=[\"$REPO/packages/plugin/plugins/kitbash/scripts/kit-mcp.mjs\"]" \
        -c "mcp_servers.kitbash.env={KIT_HOME=\"$KIT_HOME\",KIT_KEYCHAIN=\"0\",KIT_API_URL=\"$KIT_API_URL\"}" \
        -c 'mcp_servers.kitbash.default_tools_approval_mode="approve"' \
        "$PROMPT" < /dev/null > "$WORK/codex.jsonl" 2> "$WORK/codex.err") || echo "codex exited $?"
    echo "codex wall seconds: $(( $(date +%s) - START ))"
    grep -o '"type":"turn.completed","usage":{[^}]*}' "$WORK/codex.jsonl" | tail -1 || true
    check_project "$P" "codex" || STATUS=1
  fi
fi

log "done (work dir $WORK)"
exit "$STATUS"
