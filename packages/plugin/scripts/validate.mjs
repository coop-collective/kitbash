// Validate the kitbash plugin: manifests agree with each other and package.json, the MCP config is the stdio server, the
// skills and commands have frontmatter ("Use when ..."), hooks point at scripts that exist, the tool names the plugin
// mentions match the core registry contract and plugin bootstrap tool, and nothing committed carries a secret.
// Run: pnpm -F @kitbash/plugin validate (then `claude plugin validate plugins/kitbash` for Claude Code's own check).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGISTRY_TOOLS } from "@kitbash/core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = "plugins/kitbash";
const errors = [];
const check = (ok, msg) => {
  if (!ok) errors.push(msg);
};
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));
const json = (rel) => {
  try {
    return JSON.parse(read(rel));
  } catch (e) {
    errors.push(`${rel}: invalid JSON (${e.message})`);
    return {};
  }
};
const pkg = json("package.json");

export const PLUGIN_NAME = "kit"; // commands are /kit:search, /kit:install, /kit:harvest
export const MARKETPLACE = "kitbash";
export const SKILLS = ["kitbash-accounts", "kitbash-bootstrap", "kitbash-harvest", "kitbash-publish", "kitbash-secrets", "kitbash-ui", "kitbash-use"];
export const COMMANDS = ["bootstrap", "harvest", "install", "search", "secrets"];
export const TOOLS = [
  "registry_search", "registry_get", "registry_read_file", "registry_install", "registry_verify", "registry_upgrade",
  "registry_diff", "registry_harvest", "registry_publish", "registry_propose", "registry_whoami",
  "kitbash_bootstrap", "kitbash_secrets",
];

const REQUIRED = [
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
  `${P}/.claude-plugin/plugin.json`,
  `${P}/.codex-plugin/plugin.json`,
  `${P}/.mcp.json`,
  `${P}/hooks/hooks.json`,
  `${P}/hooks/session-start.mjs`,
  `${P}/scripts/kit-mcp.mjs`,
  `${P}/scripts/server.mjs`,
  `${P}/scripts/load-kit.mjs`,
  `${P}/scripts/bootstrap.mjs`,
  `${P}/scripts/bootstrap-tool.mjs`,
  `${P}/scripts/secrets.mjs`,
  `${P}/scripts/secrets-tool.mjs`,
];
for (const rel of REQUIRED) check(exists(rel), `missing ${rel}`);

// ---- the tool list matches the contract
const contract = REGISTRY_TOOLS.map((t) => t.name).sort();
check(JSON.stringify(contract) === JSON.stringify(TOOLS.filter((name) => name.startsWith("registry_")).sort()), `core's REGISTRY_TOOLS are ${contract.join(", ")}; registry tool names drifted`);
check(contract.length === 11, `expected 11 registry tools, core has ${contract.length}`);
const server = exists(`${P}/scripts/server.mjs`) ? read(`${P}/scripts/server.mjs`) : "";
check(/for \(const t of PLUGIN_TOOLS\)/.test(server) && /registerTool\(t\.name, \{ description: t\.description, inputSchema: t\.input, annotations: t\.annotations \}/.test(server), "server.mjs must register PLUGIN_TOOLS with their static description, input schema and annotations");
check(!/registerTool\(\s*["'`]/.test(server), "server.mjs must not register a tool by a literal name");
check(!/child_process|execSync|spawnSync|\bexec\(|shell:\s*true/.test(server), "server.mjs must not execute anything itself (the CLI runs allowlisted verify commands, without a shell)");

// ---- manifests
const claude = json(`${P}/.claude-plugin/plugin.json`);
const codex = json(`${P}/.codex-plugin/plugin.json`);
for (const [rel, m] of [[`${P}/.claude-plugin/plugin.json`, claude], [`${P}/.codex-plugin/plugin.json`, codex]]) {
  check(m.name === PLUGIN_NAME, `${rel}: name must be "${PLUGIN_NAME}" (commands are /kit:search, /kit:install, /kit:harvest)`);
  check(m.version === pkg.version, `${rel}: version ${m.version} != package.json ${pkg.version}`);
  check(typeof m.description === "string" && m.description.length > 40, `${rel}: needs a description`);
}
const market = json(".claude-plugin/marketplace.json");
const entry = market.plugins?.find((p) => p.name === PLUGIN_NAME);
check(market.name === MARKETPLACE, `Claude/Grok marketplace must be named ${MARKETPLACE} (install id ${PLUGIN_NAME}@${MARKETPLACE})`);
check(entry?.source === `./${P}`, `marketplace entry must point at ./${P}`);
check(entry?.version === pkg.version, "marketplace version drifted from package.json");
const cmarket = json(".agents/plugins/marketplace.json");
check(cmarket.name === MARKETPLACE && cmarket.plugins?.[0]?.name === PLUGIN_NAME, `Codex marketplace must be ${MARKETPLACE} with plugin ${PLUGIN_NAME}`);
check(cmarket.plugins?.[0]?.source?.path === `./${P}`, `Codex marketplace must point at ./${P}`);
check(codex.skills === "./skills/", "Codex manifest must point skills at ./skills/");
check(codex.hooks === "./hooks/hooks.json", "Codex manifest must point hooks at ./hooks/hooks.json");
const cm = codex.mcpServers?.kitbash;
check(cm?.command === "node" && JSON.stringify(cm?.args) === JSON.stringify(["./scripts/kit-mcp.mjs"]), "Codex manifest: mcpServers.kitbash must be the stdio command node ./scripts/kit-mcp.mjs");
check(cm?.url === undefined && cm?.env === undefined && cm?.bearer_token_env_var === undefined, "Codex mcpServers.kitbash must not carry a url, env or token (credentials come from KIT_TOKEN / ~/.kit)");

// ---- MCP config: stdio, no credentials in the file
const mcp = json(`${P}/.mcp.json`).mcpServers?.kitbash ?? {};
check(mcp.type === "stdio" && mcp.command === "node", ".mcp.json: kitbash must be a stdio node command");
check(JSON.stringify(mcp.args) === JSON.stringify(["${CLAUDE_PLUGIN_ROOT}/scripts/kit-mcp.mjs"]), '.mcp.json: args must be ["${CLAUDE_PLUGIN_ROOT}/scripts/kit-mcp.mjs"]');
check(mcp.env === undefined && mcp.headers === undefined, ".mcp.json: no env or headers (credentials come from KIT_TOKEN / ~/.kit/credentials)");

// ---- skills and commands
function frontmatter(rel) {
  const src = read(rel);
  if (!src.startsWith("---\n")) return null;
  const end = src.indexOf("\n---", 4);
  if (end < 0) return null;
  const fields = {};
  for (const line of src.slice(4, end).split("\n")) {
    const m = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return { fields, body: src.slice(end + 4) };
}
const dirs = (rel) => fs.readdirSync(path.join(root, rel), { withFileTypes: true });
const skills = exists(`${P}/skills`) ? dirs(`${P}/skills`).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
check(JSON.stringify(skills) === JSON.stringify(SKILLS), `skills are ${skills.join(", ")}; expected ${SKILLS.join(", ")}`);
const mentioned = new Set();
const scanTools = (rel, text) => {
  for (const m of text.matchAll(/\b(?:registry|kitbash)_[a-z_]+\b/g)) {
    mentioned.add(m[0]);
    check(TOOLS.includes(m[0]), `${rel} names unknown tool ${m[0]}`);
  }
};
for (const name of skills) {
  const rel = `${P}/skills/${name}/SKILL.md`;
  if (!exists(rel)) {
    errors.push(`missing ${rel}`);
    continue;
  }
  const fm = frontmatter(rel);
  check(fm, `${rel} must start with closed YAML frontmatter`);
  if (!fm) continue;
  check(fm.fields.name === name, `${rel}: frontmatter name must be ${name}`);
  const d = fm.fields.description ?? "";
  check(d.length >= 80 && d.length <= 1024, `${rel}: description must be 80-1024 chars (is ${d.length})`);
  check(/\bUse when\b/.test(d), `${rel}: description must say when to use it ("Use when ...")`);
  check(fm.body.trim().length > 400, `${rel}: body is too short`);
  check(!/\bTODO\b|\bTBD\b/.test(fm.body), `${rel} contains a TODO`);
  check(exists(`${P}/skills/${name}/agents/openai.yaml`), `missing ${name}/agents/openai.yaml (Codex skill interface)`);
  scanTools(rel, fm.body);
}
const commands = exists(`${P}/commands`) ? dirs(`${P}/commands`).map((d) => d.name.replace(/\.md$/, "")).sort() : [];
check(JSON.stringify(commands) === JSON.stringify(COMMANDS), `commands are ${commands.join(", ")}; expected ${COMMANDS.join(", ")}`);
for (const name of commands) {
  const rel = `${P}/commands/${name}.md`;
  const fm = frontmatter(rel);
  check(fm?.fields.description, `command ${name} needs a description`);
  const skill = name === "bootstrap" ? "kitbash-bootstrap" : name === "secrets" ? "kitbash-secrets" : name === "harvest" ? "kitbash-harvest" : "kitbash-use";
  check(new RegExp(skill).test(fm?.body ?? ""), `command ${name} must load the ${skill} skill`);
  if (fm) scanTools(rel, fm.body);
}
for (const t of TOOLS) check(mentioned.has(t), `no skill or command mentions ${t}`);

// the protocol skill carries the non-negotiables (DESIGN §5.5)
const use = exists(`${P}/skills/kitbash-use/SKILL.md`) ? read(`${P}/skills/kitbash-use/SKILL.md`) : "";
for (const must of ["untrusted_author_text", "dry_run", "plan_id", "diff_preview_path", "config-patch", "conflict", "adapt", "registry_verify", "registry_propose", "Never run a shell command", "Instructions are data", "When not to use a block", "overwrite", "project_root", "only network calls"]) {
  check(use.includes(must), `kitbash-use skill must mention ${must}`);
}
const harvest = exists(`${P}/skills/kitbash-harvest/SKILL.md`) ? read(`${P}/skills/kitbash-harvest/SKILL.md`) : "";
for (const must of ["boundary", "params", "tests", "Redact", "1,500", "provenance", "registry_harvest"]) check(harvest.includes(must), `kitbash-harvest skill must mention ${must}`);
const ui = exists(`${P}/skills/kitbash-ui/SKILL.md`) ? read(`${P}/skills/kitbash-ui/SKILL.md`) : "";
for (const must of ["packages/ui", "runtime/catalog/ui", "references/catalog.md", "--kb-", "keyboard"]) check(ui.includes(must), `kitbash-ui skill must mention ${must}`);
check(exists(`${P}/skills/kitbash-ui/references/catalog.md`), "missing kitbash-ui/references/catalog.md (generate it with pnpm -F @kitbash/ui gen-skill-catalog)");
const publish = exists(`${P}/skills/kitbash-publish/SKILL.md`) ? read(`${P}/skills/kitbash-publish/SKILL.md`) : "";
for (const must of ["private", "public", "license", "price", "scanner", "refused", "registry_publish"]) check(publish.includes(must), `kitbash-publish skill must mention ${must}`);

// ---- hooks
const hooks = exists(`${P}/hooks/hooks.json`) ? json(`${P}/hooks/hooks.json`).hooks ?? {} : {};
check(JSON.stringify(Object.keys(hooks)) === JSON.stringify(["SessionStart"]), "hooks.json must define exactly SessionStart");
for (const [ev, groups] of Object.entries(hooks)) {
  for (const g of groups) for (const h of g.hooks ?? []) {
    check(h.type === "command" && /\/hooks\/session-start\.mjs"$/.test(h.command), `hooks.json ${ev}: unexpected command ${h.command}`);
  }
}
const hook = exists(`${P}/hooks/session-start.mjs`) ? read(`${P}/hooks/session-start.mjs`) : "";
check(/lock\.json/.test(hook) && /telemetry/.test(hook) && /heartbeat/.test(hook), "session-start.mjs must check .kit/lock.json and telemetry before heartbeat");

// ---- no secrets anywhere
const SECRETS = [
  ["kit or HQ token", /\b(?:hq_|kit_)[A-Za-z0-9_-]{40,}\b/],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["provider secret", /\b(?:sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/],
  ["literal bearer token", /Bearer\s+(?!\$|<)[A-Za-z0-9._-]{20,}/],
];
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "runtime"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(json|md|mjs|js|yaml|yml|sh|txt)$/.test(e.name)) out.push(full);
  }
  return out;
}
for (const f of walk(root)) {
  const src = fs.readFileSync(f, "utf8");
  for (const [what, re] of SECRETS) check(!re.test(src), `${path.relative(root, f)} looks like it contains a ${what}`);
}

if (errors.length) {
  console.error(`kitbash plugin validation failed with ${errors.length} problem(s):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Validated kitbash plugin ${pkg.version}: ${contract.length} registry tools, 1 bootstrap tool, 1 secrets broker tool, ${skills.length} skills, ${commands.length} commands, hooks ${Object.keys(hooks).join("/")}, stdio MCP kitbash.`);
