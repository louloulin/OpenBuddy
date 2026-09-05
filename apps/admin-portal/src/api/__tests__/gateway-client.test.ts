import { describe, expect, it, vi, beforeEach } from "vitest";
import { GatewayApiError, gatewayClient } from "../gateway-client";

/**
 * Mock OIDC token 存储
 */
vi.mock("../../auth/oidc-client", () => ({
  loadTokens: () => ({
    accessToken: "test-token",
    tokenType: "Bearer",
    expiresAt: Date.now() + 3600_000,
  }),
}));

describe("GatewayApiError", () => {
  it("carries status and code", () => {
    const err = new GatewayApiError(401, "AUTH", "nope");
    expect(err.status).toBe(401);
    expect(err.code).toBe("AUTH");
    expect(err.message).toBe("nope");
    expect(err instanceof Error).toBe(true);
  });
});

describe("gatewayClient.health", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok on 2xx", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, store: "memory", version: "abc", latencyMs: 1 }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const h = await gatewayClient.health();
    expect(h.ok).toBe(true);
    expect(h.version).toBe("abc");
  });

  it("throws on non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(gatewayClient.health()).rejects.toThrow(GatewayApiError);
  });
});

describe("gatewayClient CRUD", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listCreditPricing returns data array", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ model: "MiniMax-M3", inputPointsPerThousand: 12, outputPointsPerThousand: 40, minimumPoints: 1 }] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = await gatewayClient.listCreditPricing("tid-1");
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.model).toBe("MiniMax-M3");
  });

  it("updateCreditPricing sends PATCH", async () => {
    let captured: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return new Response(JSON.stringify({ data: { model: "MiniMax-M3", inputPointsPerThousand: 12, outputPointsPerThousand: 40, minimumPoints: 1 } }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await gatewayClient.updateCreditPricing("tid-1", { inputPointsPerThousand: 99 });
    expect(captured?.method).toBe("PATCH");
    expect(captured?.body).toContain("99");
  });

  it("surfaces Gateway error code+message", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "TENANT_MEMBERSHIP_REQUIRED", message: "no access" }), { status: 403 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await gatewayClient.listWallets("tid-x");
      expect.fail("should throw");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(GatewayApiError);
      const e = err as GatewayApiError;
      expect(e.status).toBe(403);
      expect(e.code).toBe("TENANT_MEMBERSHIP_REQUIRED");
      expect(e.message).toBe("no access");
    }
  });
});
