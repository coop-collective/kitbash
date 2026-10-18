import { estimateJsonTokens } from "@kitbash/core";
import { describe, expect, it } from "vitest";
import { call, member, publishFixture } from "./helpers";

const asNext = (m: Record<string, any>) => {
  m.stack.framework = "nextjs";
  m.variants[0].stack = { framework: "nextjs", ui: "react" };
};

describe("search", () => {
  it('finds the fixture for "email code" with a card under 100 tokens', async () => {
    const a = await member();
    await publishFixture(a);
    const r = await call(`/api/search?q=${encodeURIComponent("email code")}&framework=hono&db=d1`, { token: a.token });
    expect(r.status).toBe(200);
    const card = r.json.results.find((c: { id: string }) => c.id === `@${a.org.slug}/email-code-auth-fixture`);
    expect(card).toBeDefined();
    expect(card.version).toBe("1.3.0");
    expect(card.variant).toBe("hono-d1");
    expect(card.stack).toContain("hono");
    expect(card.score).toBeGreaterThan(0);
    expect(card.score).toBeLessThanOrEqual(1);
    const { summary: _s, ...rest } = card;
    expect(estimateJsonTokens(rest)).toBeLessThan(100);
    expect(card.summary.length).toBeLessThanOrEqual(160);
  });

  it("boosts the block whose stack matches", async () => {
    const a = await member();
    await publishFixture(a, { name: "email-auth-next", edit: asNext });
    await publishFixture(a, { name: "email-auth-hono" });
    const hono = await call(`/api/search?q=email+code+sign&framework=hono&scope=private`, { token: a.token });
    const mine = (r: any) => r.json.results.filter((c: { id: string }) => c.id.startsWith(`@${a.org.slug}/`)).map((c: { id: string }) => c.id);
    expect(mine(hono)).toEqual([`@${a.org.slug}/email-auth-hono`, `@${a.org.slug}/email-auth-next`]);
    const next = await call(`/api/search?q=email+code+sign&framework=nextjs`, { token: a.token });
    expect(mine(next)).toEqual([`@${a.org.slug}/email-auth-next`, `@${a.org.slug}/email-auth-hono`]);
    const [h0, h1] = hono.json.results.filter((c: { id: string }) => c.id.startsWith(`@${a.org.slug}/`));
    expect(h0.score).toBeGreaterThan(h1.score);
  });

  it("matches tables, routes and stemmed words", async () => {
    const a = await member();
    await publishFixture(a);
    const ids = async (q: string) => (await call(`/api/search?q=${encodeURIComponent(q)}`, { token: a.token })).json.results.map((c: { id: string }) => c.id);
    expect(await ids("login_codes")).toContain(`@${a.org.slug}/email-code-auth-fixture`);
    expect(await ids("verify")).toContain(`@${a.org.slug}/email-code-auth-fixture`);
    expect(await ids("tokens")).toContain(`@${a.org.slug}/email-code-auth-fixture`);
  });

  it("returns an empty list when nothing matches, never an error", async () => {
    const a = await member();
    const r = await call("/api/search?q=zzqqxxunmatchable", { token: a.token });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ results: [] });
    expect((await call("/api/search?q=%21%21%21", { token: a.token })).json).toEqual({ results: [] });
  });

  it("never shows another org's private blocks", async () => {
    const a = await member();
    const b = await member();
    await publishFixture(a, { name: "secret-sauce-auth" });
    const r = await call("/api/search?q=email+code", { token: b.token });
    expect(r.json.results.map((c: { id: string }) => c.id)).not.toContain(`@${a.org.slug}/secret-sauce-auth`);
    expect((await call(`/api/blocks/${a.org.slug}/secret-sauce-auth`, { token: b.token })).status).toBe(404);
  });

  it("filters by tags (categories) and visibility", async () => {
    const a = await member();
    await publishFixture(a, { name: "tagged-auth" });
    const id = `@${a.org.slug}/tagged-auth`;
    const ids = async (qs: string) => (await call(`/api/search?q=email&${qs}`, { token: a.token })).json.results.map((c: { id: string }) => c.id);
    expect(await ids("tags=auth,email")).toContain(id);
    expect(await ids("tags=billing")).not.toContain(id);
    expect(await ids("scope=public")).not.toContain(id);
    expect(await ids("scope=private")).toContain(id);
  });

  it("shows one card per block (its latest) and drops yanked versions", async () => {
    const a = await member();
    await publishFixture(a, { name: "versioned-auth", version: "1.0.0" });
    await publishFixture(a, { name: "versioned-auth", version: "1.1.0" });
    const id = `@${a.org.slug}/versioned-auth`;
    const cards = async () => (await call("/api/search?q=email+code&limit=20&scope=private", { token: a.token })).json.results.filter((c: { id: string }) => c.id === id);
    expect((await cards()).map((c: { version: string }) => c.version)).toEqual(["1.1.0"]);
    await call(`/api/blocks/${a.org.slug}/versioned-auth/1.1.0/yank`, { token: a.token, body: {} });
    expect((await cards()).map((c: { version: string }) => c.version)).toEqual(["1.0.0"]);
    await call(`/api/blocks/${a.org.slug}/versioned-auth/1.0.0/yank`, { token: a.token, body: {} });
    expect(await cards()).toEqual([]);
  });

  it("honours limit and refuses bad queries", async () => {
    const a = await member();
    for (const n of ["lim-a", "lim-b", "lim-c"]) await publishFixture(a, { name: n });
    expect((await call("/api/search?q=email&limit=2", { token: a.token })).json.results).toHaveLength(2);
    expect((await call("/api/search?q=", { token: a.token })).status).toBe(400);
    expect((await call("/api/search?q=x&limit=50", { token: a.token })).status).toBe(400);
    expect((await call("/api/search?q=x&scope=everything", { token: a.token })).status).toBe(400);
  });
});
