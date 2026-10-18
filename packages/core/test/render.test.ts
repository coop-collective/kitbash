import { describe, expect, it } from "vitest";
import { RenderError } from "../src/errors.ts";
import { MODIFIERS, referencedParams, renderTemplate, resolveParams, unrender, validateParamValue } from "../src/render.ts";
import type { ParamDef } from "../src/schema.ts";

const params = { appSlug: "my-app", tokenPrefix: "mc_", tablePrefix: "", mailer: "resend", ttl: 10, on: true };

describe("renderTemplate", () => {
  it("substitutes params and path tokens", () => {
    expect(renderTemplate("const p = '{{kit.tokenPrefix}}'; // {{paths.lib}}", { params, paths: { lib: "src/lib" } })).toBe("const p = 'mc_'; // src/lib");
    expect(renderTemplate("{{ kit.ttl }}*60", { params })).toBe("10*60");
  });

  it("applies modifiers", () => {
    const r = (m: string) => renderTemplate(`{{kit.appSlug|${m}}}`, { params });
    expect(r("pascal")).toBe("MyApp");
    expect(r("camel")).toBe("myApp");
    expect(r("snake")).toBe("my_app");
    expect(r("kebab")).toBe("my-app");
    expect(r("upper")).toBe("MY_APP");
    expect(MODIFIERS.snake("fooBarBaz")).toBe("foo_bar_baz");
    expect(renderTemplate("{{kit.appSlug | upper | lower}}", { params })).toBe("my_app");
  });

  it("|rel gives a relative import path from the file's own directory", () => {
    const ctx = { params, paths: { lib: "src/lib", tests: "test", routes: "src/routes" } };
    expect(renderTemplate('from "{{paths.lib|rel}}/auth"', { ...ctx, fileDir: "test" })).toBe('from "../src/lib/auth"');
    expect(renderTemplate('from "{{paths.lib|rel}}/auth"', { ...ctx, fileDir: "src/routes" })).toBe('from "../lib/auth"');
    expect(renderTemplate('from "{{paths.lib|rel}}/auth"', { ...ctx, fileDir: "src" })).toBe('from "./lib/auth"');
    expect(() => renderTemplate("{{kit.appSlug|rel}}", { ...ctx, fileDir: "" })).toThrow(RenderError);
  });

  it("evaluates conditionals with else, != and nesting; standalone tag lines vanish", () => {
    const t = `a\n{{#kit.if mailer == "resend"}}\nR\n{{#kit.if on}}\nON\n{{/kit.if}}\n{{kit.else}}\nE\n{{/kit.if}}\nz`;
    expect(renderTemplate(t, { params })).toBe("a\nR\nON\nz");
    expect(renderTemplate(t, { params: { ...params, mailer: "console" } })).toBe("a\nE\nz");
    expect(renderTemplate(`{{#kit.if mailer != 'console'}}x{{/kit.if}}`, { params })).toBe("x");
    expect(renderTemplate(`{{#kit.if !tablePrefix}}none{{/kit.if}}`, { params })).toBe("none");
  });

  it("leaves foreign {{ }} alone (JSX, Handlebars)", () => {
    const jsx = "<div style={{ color: 'red' }}>{{name}}</div>";
    expect(renderTemplate(jsx, { params })).toBe(jsx);
  });

  it("throws on unknown params, path tokens, modifiers and malformed or unbalanced tags", () => {
    expect(() => renderTemplate("{{kit.nope}}", { params })).toThrow(/unknown param/);
    expect(() => renderTemplate("{{paths.nope}}", { params, paths: {} })).toThrow(/unknown path token/);
    expect(() => renderTemplate("{{kit.appSlug|shout}}", { params })).toThrow(/modifier/);
    expect(() => renderTemplate("{{kit.appSlug", { params })).toThrow(/malformed/);
    expect(() => renderTemplate("{{#kit.if on}}x", { params })).toThrow(/unterminated/);
    expect(() => renderTemplate("{{/kit.if}}", { params })).toThrow(RenderError);
    expect(() => renderTemplate("{{#kit.if nope}}x{{/kit.if}}", { params })).toThrow(/unknown param/);
  });

  it("never re-interprets a substituted value as a token", () => {
    // validation forbids {{ in values; even if a caller skipped it, the output isn't rendered twice
    expect(renderTemplate("{{kit.v}}", { params: { v: "{{kit.appSlug}}" } })).toBe("{{kit.appSlug}}");
  });

  it("lists referenced params", () => {
    expect(referencedParams("{{kit.tablePrefix}}members {{#kit.if mailer == 'x'}}{{/kit.if}}").sort()).toEqual(["mailer", "tablePrefix"]);
  });
});

describe("param validation", () => {
  const ident: ParamDef = { name: "tokenPrefix", type: "identifier", pattern: "^[a-z]{2,6}_$" };
  it("identifier: pattern and base charset", () => {
    expect(validateParamValue(ident, "mc_").ok).toBe(true);
    expect(validateParamValue(ident, "MC_").ok).toBe(false);
    expect(validateParamValue(ident, "mc_'; drop table x; --").ok).toBe(false);
    expect(validateParamValue({ name: "x", type: "identifier" }, "a-b_c").ok).toBe(true);
    expect(validateParamValue({ name: "x", type: "identifier", pattern: ".*" }, "a b").ok).toBe(false); // base charset still applies
  });

  it("string refuses quote, backslash, backtick, ${, {{ and control/invisible characters", () => {
    const s: ParamDef = { name: "d", type: "string" };
    expect(validateParamValue(s, "example.com").ok).toBe(true);
    for (const bad of ['a"b', "a'b", "a`b", "a\\b", "${x}", "{{kit.x}}", "a\nb", "a​b", "<script>"]) {
      expect(validateParamValue(s, bad).ok, bad).toBe(false);
    }
  });

  it("path, integer, boolean, enum", () => {
    expect(validateParamValue({ name: "p", type: "path" }, "/auth/v1").ok).toBe(true);
    expect(validateParamValue({ name: "p", type: "path" }, "/a/../b").ok).toBe(false);
    expect(validateParamValue({ name: "p", type: "path" }, "auth").ok).toBe(false);
    expect(validateParamValue({ name: "n", type: "integer", min: 2, max: 60 }, "10")).toEqual({ ok: true, value: 10 });
    expect(validateParamValue({ name: "n", type: "integer", min: 2, max: 60 }, 61).ok).toBe(false);
    expect(validateParamValue({ name: "n", type: "integer" }, 1.5).ok).toBe(false);
    expect(validateParamValue({ name: "b", type: "boolean" }, "false")).toEqual({ ok: true, value: false });
    expect(validateParamValue({ name: "e", type: "enum", values: ["a", "b"] }, "c").ok).toBe(false);
  });

  it("resolveParams merges supplied > inferred > default and rejects unknown names", () => {
    const defs: ParamDef[] = [
      { name: "appSlug", type: "identifier", default: "my-app" },
      { name: "ttl", type: "integer", default: 10 },
      { name: "req", type: "string", required: true },
    ];
    const r = resolveParams(defs, { ttl: "5", req: "x", bogus: 1 }, { appSlug: "inferred" });
    expect(r.values).toEqual({ appSlug: "inferred", ttl: 5, req: "x" });
    expect(r.errors).toEqual(["bogus: unknown param"]);
    expect(resolveParams(defs, {}).errors).toContain("req: required (no default)");
  });
});

describe("unrender", () => {
  it("restores tokens in one pass, longest value first", () => {
    const r = unrender("const t = 'mc_x'; db = 'mailcheap'; app mailcheap-api", { appSlug: "mailcheap", tokenPrefix: "mc_", apiName: "mailcheap-api" });
    expect(r.text).toBe("const t = '{{kit.tokenPrefix}}x'; db = '{{kit.appSlug}}'; app {{kit.apiName}}");
    expect(r.replaced).toBe(3);
  });
  it("skips short values, numbers and booleans", () => {
    expect(unrender("a 10 true", { a: "a", n: 10, b: true }).replaced).toBe(0);
  });
});
