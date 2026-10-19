import { describe, expect, test } from "bun:test";
import { handleRequest, parsePort } from "../src/app.ts";

describe("configuration", () => {
  test("validates the full port value", () => {
    expect(parsePort(undefined)).toBe(3000);
    expect(parsePort("65535")).toBe(65535);
    for (const value of ["", "0", "65536", "1.5", "3000junk", "-1", " 3000"]) {
      expect(() => parsePort(value)).toThrow();
    }
  });
});

describe("health endpoint", () => {
  test("is uncached JSON, including over a real listener", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleRequest });
    try {
      const response = await fetch(new URL("/healthz", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ ok: true });
    } finally { await server.stop(true); }
  });
  test("HEAD has no body", async () => {
    const response = handleRequest(new Request("http://localhost/healthz", { method: "HEAD" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
  test("rejects unknown routes and methods", () => {
    expect(handleRequest(new Request("http://localhost/missing")).status).toBe(404);
    const response = handleRequest(new Request("http://localhost/healthz", { method: "POST" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });
});
