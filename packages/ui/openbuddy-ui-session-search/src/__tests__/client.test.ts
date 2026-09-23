import { describe, expect, it } from "vitest";
import { createHostSessionSearchClient, InMemorySessionSearchClient } from "../client.js";

describe("createHostSessionSearchClient", () => {
  it("forwards search params to the underlying call", async () => {
    const calls: any[] = [];
    const client = createHostSessionSearchClient(async (method, params) => {
      calls.push({ method, params });
      return { hits: [], total: 0 };
    });
    await client.search("rust", 25);
    expect(calls).toEqual([
      { method: "session.search", params: { query: "rust", maxResults: 25 } },
    ]);
  });

  it("returns an empty result when the host returns null/undefined", async () => {
    const client = createHostSessionSearchClient(async () => undefined);
    expect(await client.search("anything")).toEqual({ hits: [], total: 0 });
  });
});

describe("InMemorySessionSearchClient", () => {
  it("returns empty results for blank queries", async () => {
    const c = new InMemorySessionSearchClient();
    expect(await c.search("")).toEqual({ hits: [], total: 0 });
    expect(await c.search("   ")).toEqual({ hits: [], total: 0 });
  });

  it("counts and ranks hits across sessions", async () => {
    const c = new InMemorySessionSearchClient();
    c.addSession("a", [
      { content: "foo foo foo" },
      { content: "bar" },
    ]);
    c.addSession("b", [{ content: "foo once" }]);
    const res = await c.search("foo", 50);
    expect(res.total).toBe(2);
    // session a has 3 occurrences → higher rank
    expect(res.hits[0].sessionId).toBe("a");
  });

  it("returns a snippet around the match", async () => {
    const c = new InMemorySessionSearchClient();
    c.addSession("s", [{ content: "padding ".repeat(20) + "needle" + " padding".repeat(20) }]);
    const res = await c.search("needle");
    expect(res.hits.length).toBe(1);
    expect(res.hits[0].snippet).toContain("needle");
  });

  it("message() throws for unknown session/line", async () => {
    const c = new InMemorySessionSearchClient();
    await expect(c.message("unknown")).rejects.toThrow(/not found/);
  });
});
