import { describe, expect, it, vi } from "vitest";
import {
  NEWAPI_PROVIDER_DEFAULTS,
  fetchNewapiModels,
  isValidNewapiKey,
  newapiModelToEntry,
  newapiProviderDefaultsForUi,
  normalizeNewapiBaseUrl,
  type NewapiModelEntry,
} from "../billing/newapi-provider";

describe("normalizeNewapiBaseUrl", () => {
  it("appends /v1 to bare host", () => {
    expect(normalizeNewapiBaseUrl("http://124.221.146.145:3000")).toBe(
      "http://124.221.146.145:3000/v1",
    );
  });
  it("keeps existing /v1", () => {
    expect(normalizeNewapiBaseUrl("http://x:3000/v1")).toBe("http://x:3000/v1");
  });
  it("strips trailing slash before adding /v1", () => {
    expect(normalizeNewapiBaseUrl("http://x:3000/")).toBe("http://x:3000/v1");
  });
  it("supports https", () => {
    expect(normalizeNewapiBaseUrl("https://newapi.example.com")).toBe(
      "https://newapi.example.com/v1",
    );
  });
  it("rejects empty", () => {
    expect(() => normalizeNewapiBaseUrl("")).toThrow(/不能为空/);
  });
  it("rejects malformed URL", () => {
    expect(() => normalizeNewapiBaseUrl("not a url")).toThrow(/合法 URL/);
  });
  it("rejects unsupported scheme", () => {
    expect(() => normalizeNewapiBaseUrl("ftp://x.example.com")).toThrow(/http/);
  });
  it("rejects userinfo / query / fragment", () => {
    expect(() => normalizeNewapiBaseUrl("http://user:pass@x/v1")).toThrow();
    expect(() => normalizeNewapiBaseUrl("http://x/v1?token=abc")).toThrow();
    expect(() => normalizeNewapiBaseUrl("http://x/v1#frag")).toThrow();
  });
});

describe("isValidNewapiKey", () => {
  it("accepts sk- prefixed keys", () => {
    expect(isValidNewapiKey("sk-abc123")).toBe(true);
  });
  it("accepts other >= 6 char keys", () => {
    expect(isValidNewapiKey("foobar12345")).toBe(true);
  });
  it("rejects short keys", () => {
    expect(isValidNewapiKey("abc")).toBe(false);
    expect(isValidNewapiKey("")).toBe(false);
  });
});

describe("newapiModelToEntry", () => {
  it("maps an OpenAI-style model entry", () => {
    const out = newapiModelToEntry({ id: "MiniMax-M3" } as NewapiModelEntry, "newapi-1");
    expect(out.modelId).toBe("MiniMax-M3");
    expect(out.providerId).toBe("newapi-1");
    expect(out.contextWindow).toBe(NEWAPI_PROVIDER_DEFAULTS.defaultContextWindow);
  });
  it("uses caller-supplied contextWindow", () => {
    const out = newapiModelToEntry({ id: "x" } as NewapiModelEntry, "p", 32_000);
    expect(out.contextWindow).toBe(32_000);
  });
});

describe("newapiProviderDefaultsForUi", () => {
  it("returns sane defaults", () => {
    const d = newapiProviderDefaultsForUi();
    expect(d.providerKind).toBe("newapi");
    expect(d.apiBackend).toBe("chat_completions");
    expect(d.authScheme).toBe("bearer");
    expect(d.contextWindow).toBeGreaterThan(0);
    expect(d.baseUrl).toMatch(/\/v1$/);
  });
});

describe("fetchNewapiModels", () => {
  it("calls /v1/models with bearer auth and returns data array", async () => {
    const fake = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toMatch(/\/v1\/models$/);
      return new Response(
        JSON.stringify({
          data: [{ id: "MiniMax-M3" }, { id: "deepseek-v4-flash" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const models = await fetchNewapiModels("http://x:3000", "sk-abc", { fetchImpl: fake });
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe("MiniMax-M3");
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it("throws on non-2xx", async () => {
    const fake = vi.fn(async () => new Response("bad", { status: 401 }));
    await expect(fetchNewapiModels("http://x:3000", "sk-abc", { fetchImpl: fake })).rejects.toThrow(
      /401/,
    );
  });
  it("throws on malformed body", async () => {
    const fake = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    await expect(fetchNewapiModels("http://x:3000", "sk-abc", { fetchImpl: fake })).rejects.toThrow(
      /data/,
    );
  });
  it("filters out empty ids", async () => {
    const fake = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ id: "real" }, { id: "" }, { not_id: "x" }] }),
          { status: 200 },
        ),
    );
    const models = await fetchNewapiModels("http://x:3000", "sk-abc", { fetchImpl: fake });
    expect(models.map((m) => m.id)).toEqual(["real"]);
  });
});
