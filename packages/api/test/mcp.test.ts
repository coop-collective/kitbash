// The remote MCP server driven by the real MCP SDK client over Streamable HTTP inside workerd.
import { REGISTRY_TOOLS } from "@kitbash/core";
import { describe, expect, it } from "vitest";
import { call, mcp, member, publishFixture, tool } from "./helpers";

describe("/mcp", () => {
  it("lists the 11 registry tools with core's descriptions and annotations", async () => {
    const a = await member();
    const c = await mcp(a.token);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(REGISTRY_TOOLS.map((t) => t.name).sort());
    expect(tools).toHaveLength(11);
    for (const def of REGISTRY_TOOLS) {
      const t = tools.find((x) => x.name === def.name)!;
      expect(t.description).toBe(def.description);
      expect(t.annotations?.readOnlyHint).toBe(def.annotations.readOnlyHint);
      expect(t.annotations?.destructiveHint).toBe(def.annotations.destructiveHint);
    }
    for (const n of ["registry_search", "registry_get", "registry_read_file", "registry_whoami"]) {
      expect(tools.find((t) => t.name === n)!.annotations?.readOnlyHint).toBe(true);
    }
    expect(tools.find((t) => t.name === "registry_search")!.inputSchema.required).toContain("query");
  });

  it("registry_search returns the same card as REST", async () => {
    const a = await member();
    await publishFixture(a);
    const c = await mcp(a.token);
    const viaMcp = await tool(c, "registry_search", { query: "email code", stack: { framework: "hono" } });
    expect(viaMcp.isError).toBe(false);
    const viaRest = await call("/api/search?q=email+code&framework=hono", { token: a.token });
    expect(viaMcp.data).toEqual(viaRest.json);
    expect(viaMcp.data.results.map((x: { id: string }) => x.id)).toContain(`@${a.org.slug}/email-code-auth-fixture`);
    expect(viaMcp.structured).toEqual(viaMcp.data);
  });

  it("registry_get, registry_read_file and registry_whoami answer like REST", async () => {
    const a = await member();
    await publishFixture(a);
    const c = await mcp(a.token);
    const id = `@${a.org.slug}/email-code-auth-fixture`;
    const s = await tool(c, "registry_get", { block: id });
    expect(s.data).toEqual((await call(`/api/blocks/${a.org.slug}/email-code-auth-fixture/latest/summary`, { token: a.token })).json);
    expect((await tool(c, "registry_get", { block: `${id}@1.3.0`, detail: "files" })).data.files).toHaveLength(12);
    expect((await tool(c, "registry_get", { block: id, detail: "skill" })).data.detail).toBe("skill");
    const f = await tool(c, "registry_read_file", { block: id, version: "1.3.0", path: "src/auth/tokens.ts" });
    expect(f.data.content).toContain("export");
    expect((await tool(c, "registry_whoami")).data).toEqual((await call("/api/me", { token: a.token })).json);
  });

  it("local-only tools answer needs_local with the kit command", async () => {
    const a = await member();
    const c = await mcp(a.token);
    const r = await tool(c, "registry_install", { block: "@coop/email-code-auth", project_root: ".", params: { tokenPrefix: "mc_" }, dry_run: false });
    expect(r.isError).toBe(true);
    expect(r.data.error.code).toBe("needs_local");
    expect(r.data.error.command).toBe("kit install @coop/email-code-auth --param tokenPrefix=mc_ --apply");
    const v = await tool(c, "registry_verify", { block: "@coop/email-code-auth", project_root: "." });
    expect(v.data.error).toMatchObject({ code: "needs_local", command: "kit verify @coop/email-code-auth" });
    const p = await tool(c, "registry_publish", { block_dir: "blocks/x", visibility: "private" });
    expect(p.data.error.command).toBe("kit publish blocks/x --visibility private");
    const u = await tool(c, "registry_upgrade", { block: "@coop/email-code-auth", project_root: ".", to: "1.4.0" });
    expect(u.data.error.command).toBe("kit upgrade @coop/email-code-auth --to 1.4.0");
    const d = await tool(c, "registry_diff", { block: "@coop/email-code-auth", project_root: "." });
    expect(d.data.error.command).toBe("kit diff @coop/email-code-auth");
    const h = await tool(c, "registry_harvest", { project_root: ".", paths: ["src/auth"], name: "my-auth", description: "Email codes" });
    expect(h.data.error.command).toBe('kit harvest --name my-auth --paths src/auth --desc "Email codes"');
    const pr = await tool(c, "registry_propose", { block: "@coop/email-code-auth", project_root: ".", title: "Cooldown", rationale: "double click" });
    expect(pr.data.error.command).toBe('kit propose @coop/email-code-auth --title "Cooldown" --why "double click"');
  });

  it("returns errors as isError results with the contract envelope", async () => {
    const a = await member();
    const c = await mcp(a.token);
    const r = await tool(c, "registry_get", { block: `@${a.org.slug}/missing` });
    expect(r.isError).toBe(true);
    expect(r.data.error.code).toBe("not_found");
  });
});
