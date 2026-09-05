import { describe, expect, it, vi } from "vitest";
import { parseTenantIds, runCreditExpiry, expirySignature } from "./credit-expiry-worker.mjs";

describe("credit expiry worker", () => {
  it("requires an explicit bounded tenant list", () => {
    expect(() => parseTenantIds(undefined)).toThrow("1-500");
    expect(() => parseTenantIds(["tenant-a", "tenant-a"])).toThrow("invalid or duplicate");
    expect(parseTenantIds(["tenant-b", "tenant-a"])).toEqual(["tenant-a", "tenant-b"]);
  });

  it("signs the exact payload and uses an idempotency key", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.headers["idempotency-key"]).toBe("credit-expiry-test-1");
      expect(init.headers["x-openbuddy-credit-expiry-signature"]).toBe(expirySignature("a".repeat(32), init.headers["x-openbuddy-credit-expiry-timestamp"], init.body));
      expect(JSON.parse(init.body)).toEqual({ tenantIds: ["tenant-a"] });
      return new Response(JSON.stringify({ status: "ok", data: { expired: 4 } }), { status: 200 });
    });
    await expect(runCreditExpiry({ gatewayUrl: "http://gateway.test", secret: "a".repeat(32), tenantIds: ["tenant-a"], requestId: "credit-expiry-test-1", now: 1_700_000_000_000, fetchImpl })).resolves.toMatchObject({ status: "succeeded", tenantIds: ["tenant-a"] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when no tenant list is provided", async () => {
    await expect(runCreditExpiry({ gatewayUrl: "http://gateway.test", secret: "a".repeat(32) })).rejects.toThrow("tenant ids");
  });
});
