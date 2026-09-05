import { describe, expect, it, vi } from "vitest";
import { CasdoorResourceBackend } from "@openbuddy/auth-casdoor";

describe("Casdoor remote resource backend", () => {
  it("keeps the bearer token in main-process requests and sends optimistic versions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      id: "project-1", tenantId: "tenant-a", ownerSubject: "user-a", type: "project", name: "Project", metadata: { provider: "webdav", accessToken: "discard" }, createdAt: "2026-01-01", updatedAt: "2026-01-01", version: 2,
    } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    const resource = await backend.update("secret-token", "tenant-a", "project-1", { expectedVersion: 1, name: "Updated" });
    expect(resource.metadata).toEqual({ provider: "webdav" });
    expect(fetchMock).toHaveBeenCalledWith("https://resource.test/v1/tenants/tenant-a/resources/project-1", expect.objectContaining({ method: "PATCH", headers: expect.objectContaining({ authorization: "Bearer secret-token", "if-match": "1" }) }));
  });

  it("rejects unsafe API URLs", () => {
    expect(() => new CasdoorResourceBackend("https://user:password@resource.test")).toThrow("企业资源 API 地址无效");
    expect(() => new CasdoorResourceBackend("https://resource.test/path?token=secret")).toThrow("企业资源 API 地址无效");
  });

  it("preserves stable gateway error codes for main-process callers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "error", code: "TENANT_POLICY_VERSION_CONFLICT", message: "stale" }), { status: 409 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    await expect(backend.updateTenantPolicy("secret-token", "tenant-a", { expectedVersion: 1, maxResources: 20 })).rejects.toMatchObject({ code: "TENANT_POLICY_VERSION_CONFLICT", statusCode: 409 });
  });

  it("encodes member subjects and validates revocation responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      subject: "tenant/user name", revoked: true, revokedAt: "2026-01-01T00:00:00.000Z", revokedBy: "admin", reason: "offboarding",
    } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    await expect(backend.setMemberRevocation("secret-token", "tenant/a", "tenant/user name", true, "offboarding")).resolves.toMatchObject({ subject: "tenant/user name", revoked: true });
    expect(fetchMock).toHaveBeenCalledWith("https://resource.test/v1/tenants/tenant%2Fa/member-revocations/tenant%2Fuser%20name", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ revoked: true, reason: "offboarding" }), headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
  });

  it("lists only well-formed revoked members", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { subject: "user-a", revokedAt: "2026-01-01T00:00:00.000Z", revokedBy: "admin", reason: "offboarding" },
      { subject: "invalid" },
    ] }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    await expect(backend.listMemberRevocations("secret-token", "tenant-a")).resolves.toEqual([{ subject: "user-a", revoked: true, revokedAt: "2026-01-01T00:00:00.000Z", revokedBy: "admin", reason: "offboarding" }]);
    expect(fetchMock).toHaveBeenCalledWith("https://resource.test/v1/tenants/tenant-a/member-revocations", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
  });

  it("lists well-formed shared wallets and their roles", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "wallet-1", tenantId: "tenant-a", name: "Team", status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "owner", members: [{ walletId: "wallet-1", tenantId: "tenant-a", subject: "user-a", role: "spender", createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "owner" }] },
      { id: "invalid", tenantId: "tenant-b", name: "Other", status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "owner" },
    ] }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    await expect(backend.listCreditWallets("secret-token", "tenant-a")).resolves.toMatchObject([{ id: "wallet-1", members: [{ subject: "user-a", role: "spender" }] }]);
    expect(fetchMock).toHaveBeenCalledWith("https://resource.test/v1/tenants/tenant-a/wallets", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
  });

  it("normalizes the commercial catalog and calls the tenant endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      group: "enterprise-ai", capabilitySource: "gateway-config", pricingSource: "gateway-pricing", generatedAt: "2026-08-30T00:00:00.000Z", models: [{ id: "demo-model", sellable: true, capabilities: { "chat.completions": { supported: true, usage: "required" }, unknown: { supported: true } }, pricing: { model: "demo-model", inputPointsPerThousand: 2, outputPointsPerThousand: 5, minimumPoints: 1, updatedAt: "2026-08-30T00:00:00.000Z" } }, { id: "invalid" }] }, }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    await expect(backend.getCommercialModelCatalog("secret-token", "tenant-a")).resolves.toMatchObject({ group: "enterprise-ai", models: [{ id: "demo-model", sellable: true, capabilities: { "chat.completions": { supported: true, usage: "required" } } }] });
    expect(fetchMock).toHaveBeenCalledWith("https://resource.test/v1/tenants/tenant-a/ai/catalog", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
  });

  it("reads selected wallet credits and wallet-scoped ledger", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { tenantId: "tenant-a", subject: "wallet:wallet-1", walletId: "wallet-1", plan: "team-wallet", balance: 100, reserved: 10, available: 90, lifetimeGranted: 100, lifetimeConsumed: 0, lifetimeRefunded: 0, lifetimeExpired: 0, updatedAt: "2026-01-01", version: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "entry-1", tenantId: "tenant-a", subject: "wallet:wallet-1", walletId: "wallet-1", type: "consume", amount: 10, unit: "points", createdAt: "2026-01-01" }] }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    await expect(backend.getCreditWalletCredits("secret-token", "tenant-a", "wallet-1")).resolves.toMatchObject({ walletId: "wallet-1", available: 90 });
    await expect(backend.listCreditWalletLedger("secret-token", "tenant-a", "wallet-1", 8)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://resource.test/v1/tenants/tenant-a/wallets/wallet-1/credits", expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://resource.test/v1/tenants/tenant-a/wallets/wallet-1/ledger?limit=8", expect.anything());
  });

  it("reads and updates tenant policy without exposing the bearer token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "active", maxResources: 100, updatedAt: "2026-01-01T00:00:00.000Z" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "suspended", maxResources: 50, version: 2, updatedAt: "2026-01-02T00:00:00.000Z", updatedBy: "admin" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ tenantId: "tenant-a", action: "update", outcome: "success" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "active", maxResources: 100, maxTokensPerDay: 1000, tokensUsedToday: 80, updatedAt: "2026-01-03T00:00:00.000Z" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "archived", maxResources: 100, updatedAt: "2026-01-04T00:00:00.000Z" } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    await expect(backend.getTenantPolicy("secret-token", "tenant-a")).resolves.toMatchObject({ status: "active", maxResources: 100 });
    await expect(backend.updateTenantPolicy("secret-token", "tenant-a", { expectedVersion: 1, status: "suspended", maxResources: 50 })).resolves.toMatchObject({ status: "suspended", maxResources: 50, version: 2 });
    await expect(backend.listTenantAudit("secret-token", "tenant-a", 20)).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://resource.test/v1/tenants/tenant-a/policy", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://resource.test/v1/tenants/tenant-a/policy", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ expectedVersion: 1, status: "suspended", maxResources: 50 }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://resource.test/v1/tenants/tenant-a/audit?limit=20", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
    await expect(backend.getRuntimePolicy("secret-token", "tenant-a")).resolves.toMatchObject({ maxTokensPerDay: 1000, tokensUsedToday: 80 });
    expect(fetchMock).toHaveBeenNthCalledWith(4, "https://resource.test/v1/tenants/tenant-a/runtime-policy", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
    await expect(backend.recordRuntimeUsage("secret-token", "tenant-a", 80)).resolves.toMatchObject({ status: "archived", maxResources: 100 });
    expect(fetchMock).toHaveBeenNthCalledWith(5, "https://resource.test/v1/tenants/tenant-a/runtime-usage", expect.objectContaining({ method: "POST", body: JSON.stringify({ tokens: 80 }) }));
  });

  it("reads the tenant New API capability directory and filters malformed entries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      group: "enterprise-ai",
      capabilitySource: "gateway-config",
      models: [
        { id: "MiniMax-M3", capabilities: { "chat.completions": { supported: true, streaming: true, usage: "required" }, responses: { supported: false, reason: "not implemented" } } },
        { id: "" },
        "bad",
      ],
    } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    await expect(backend.getAiCapabilities("secret-token", "tenant/a")).resolves.toEqual({
      group: "enterprise-ai",
      capabilitySource: "gateway-config",
      models: [{ id: "MiniMax-M3", capabilities: { "chat.completions": { supported: true, streaming: true, usage: "required" }, responses: { supported: false, reason: "not implemented" } } }],
    });
    expect(fetchMock).toHaveBeenCalledWith("https://resource.test/v1/tenants/tenant%2Fa/ai/capabilities", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
  });

  it("requests a server-side credit quote instead of calculating in the renderer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      model: "MiniMax-M3", promptTokens: 1200, completionTokens: 100, totalTokens: 1300, estimatedPoints: 8, unit: "points", priceBasis: "gateway-pricing", pricing: { model: "MiniMax-M3", inputPointsPerThousand: 5, outputPointsPerThousand: 20, minimumPoints: 1, updatedAt: "2026-01-01T00:00:00.000Z" }, quoteValidUntil: "2026-01-01T00:01:00.000Z",
    } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    await expect(backend.quoteCredits("secret-token", "tenant-a", { model: "MiniMax-M3", promptTokens: 1200, completionTokens: 100 })).resolves.toMatchObject({ model: "MiniMax-M3", estimatedPoints: 8, priceBasis: "gateway-pricing" });
    expect(fetchMock).toHaveBeenCalledWith("https://resource.test/v1/tenants/tenant-a/credits/quote", expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "MiniMax-M3", promptTokens: 1200, completionTokens: 100 }), headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
  });

  it("passes shared-wallet scope to the reconciliation endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
      tenantId: "tenant-a", walletId: "wallet-1", scope: "wallet", coveragePercent: 100, total: {}, byModel: {}, bySubject: {}, byAgent: {}, bySession: {}, external: {},
    } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    await expect(backend.getCreditReconciliation("secret-token", "tenant-a", "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z", "wallet-1")).resolves.toMatchObject({ walletId: "wallet-1", scope: "wallet" });
    expect(fetchMock).toHaveBeenCalledWith("https://resource.test/v1/tenants/tenant-a/credits/reconciliation?since=2026-01-01T00%3A00%3A00.000Z&until=2026-02-01T00%3A00%3A00.000Z&walletId=wallet-1", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
  });

  it("registers, lists, and unregisters session bindings via the gateway", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { sessionId: "session-1", subject: "user-a", kind: "desktop", scopes: ["agent.prompt"], startedAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ sessionId: "session-1", subject: "user-a", kind: "desktop", scopes: ["agent.prompt"], startedAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { removed: true } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    const registered = await backend.registerSession("secret-token", "tenant-a", { sessionId: "session-1", kind: "desktop", scopes: ["agent.prompt"] });
    expect(registered).toMatchObject({ sessionId: "session-1", subject: "user-a", kind: "desktop", scopes: ["agent.prompt"] });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://resource.test/v1/tenants/tenant-a/sessions", expect.objectContaining({ method: "POST", body: JSON.stringify({ sessionId: "session-1", kind: "desktop", scopes: ["agent.prompt"] }), headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));

    const list = await backend.listSessions("secret-token", "tenant-a", 100);
    expect(list).toHaveLength(1);
    expect(list[0]?.sessionId).toBe("session-1");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://resource.test/v1/tenants/tenant-a/sessions?limit=100", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));

    const removed = await backend.unregisterSession("secret-token", "tenant-a", "session-1");
    expect(removed).toEqual({ removed: true });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://resource.test/v1/tenants/tenant-a/sessions/session-1", expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
  });

  it("filters malformed session bindings and rejects empty list responses", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ sessionId: "session-1", subject: "user-a", kind: "desktop", scopes: [], startedAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" }, { sessionId: "" }, { subject: "user-b" }] }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    const list = await backend.listSessions("secret-token", "tenant-a", 10);
    expect(list).toEqual([{ sessionId: "session-1", subject: "user-a", kind: "desktop", scopes: [], startedAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" }]);
  });

  it("lists, upserts, and normalizes billing plans via the gateway", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [
        { id: "free", name: "Free", currency: "CNY", priceMinor: 0, points: 100, active: true, features: ["基础模型"], updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: "team", name: "Team", currency: "CNY", priceMinor: 9900, points: 10000, active: true, features: ["团队"], updatedAt: "2026-01-02T00:00:00.000Z" },
        { id: "malformed", name: "", points: 0 },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "team", name: "Team Pro", currency: "CNY", priceMinor: 19900, points: 20000, active: true, features: ["团队", "SLA"], description: "升级", entitlementsValidDays: 90, updatedAt: "2026-02-01T00:00:00.000Z", updatedBy: "admin" } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    const plans = await backend.listBillingPlans("secret-token", "tenant-a");
    expect(plans).toHaveLength(2);
    expect(plans.map((plan) => plan.id)).toEqual(["free", "team"]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://resource.test/v1/tenants/tenant-a/billing/plans", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
    const updated = await backend.upsertBillingPlan("secret-token", "tenant-a", { id: "team", name: "Team Pro", priceMinor: 19900, points: 20000, description: "升级", features: ["团队", "SLA"], entitlementsValidDays: 90, active: true });
    expect(updated).toMatchObject({ id: "team", name: "Team Pro", priceMinor: 19900, points: 20000, entitlementsValidDays: 90, description: "升级", updatedBy: "admin" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://resource.test/v1/tenants/tenant-a/billing/plans", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ id: "team", name: "Team Pro", priceMinor: 19900, points: 20000, description: "升级", features: ["团队", "SLA"], entitlementsValidDays: 90, active: true }), headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
  });

  it("creates, refunds, and expires billing orders via the gateway", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [
        { id: "order-1", orderNo: "ob_abc", tenantId: "tenant-a", subject: "user-a", planId: "team", points: 10000, amountMinor: 9900, currency: "CNY", status: "pending", idempotencyKey: "k1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z" },
        { id: "bad" },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "order-2", orderNo: "ob_xyz", tenantId: "tenant-a", subject: "user-a", planId: "team", points: 10000, amountMinor: 9900, currency: "CNY", status: "pending", idempotencyKey: "k2", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z", expiresAt: "2026-02-01T01:00:00.000Z" } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "order-2", orderNo: "ob_xyz", tenantId: "tenant-a", subject: "user-a", planId: "team", points: 10000, amountMinor: 9900, currency: "CNY", status: "refunded", idempotencyKey: "k2", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z", expiresAt: "2026-02-01T01:00:00.000Z", paidAt: "2026-02-01T00:30:00.000Z", refundedAt: "2026-02-02T00:00:00.000Z", paymentChannel: "wechat", paymentId: "wx-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "order-3", orderNo: "ob_exp", tenantId: "tenant-a", subject: "user-a", planId: "team", points: 10000, amountMinor: 9900, currency: "CNY", status: "expired", idempotencyKey: "k3", createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-02T00:00:00.000Z", expiresAt: "2026-03-01T01:00:00.000Z" } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    const listed = await backend.listBillingOrders("secret-token", "tenant-a", "user-a", 50);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ orderNo: "ob_abc", status: "pending" });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://resource.test/v1/tenants/tenant-a/billing/orders?subject=user-a&limit=50", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
    const created = await backend.createBillingOrder("secret-token", "tenant-a", { planId: "team", subject: "user-a", idempotencyKey: "k2", expiresInSeconds: 3600 });
    expect(created).toMatchObject({ orderNo: "ob_xyz", status: "pending" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://resource.test/v1/tenants/tenant-a/billing/orders", expect.objectContaining({ method: "POST", body: JSON.stringify({ planId: "team", subject: "user-a", idempotencyKey: "k2", expiresInSeconds: 3600 }) }));
    const refunded = await backend.refundBillingOrder("secret-token", "tenant-a", "ob_xyz");
    expect(refunded).toMatchObject({ orderNo: "ob_xyz", status: "refunded", paymentChannel: "wechat", paymentId: "wx-1" });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://resource.test/v1/tenants/tenant-a/billing/orders/ob_xyz/refund", expect.objectContaining({ method: "POST" }));
    const expired = await backend.expireBillingOrder("secret-token", "tenant-a", "ob_exp");
    expect(expired).toMatchObject({ orderNo: "ob_exp", status: "expired" });
    expect(fetchMock).toHaveBeenNthCalledWith(4, "https://resource.test/v1/tenants/tenant-a/billing/orders/ob_exp/expire", expect.objectContaining({ method: "POST" }));
  });

  it("rejects invalid billing order numbers", async () => {
    const backend = new CasdoorResourceBackend("https://resource.test", vi.fn());
    await expect(backend.refundBillingOrder("secret-token", "tenant-a", "bad order")).rejects.toThrow("订单号无效");
    await expect(backend.expireBillingOrder("secret-token", "tenant-a", "")).rejects.toThrow("订单号无效");
  });

  it("reads subscription entitlements and preserves order entitlement snapshots", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { tenantId: "tenant-a", subject: "user-a", planId: "team", orderNo: "ob_paid", status: "active", entitlements: { maxTokensPerDay: 100000, maxPointsPerDay: 10000, newApiGroup: "team" }, startedAt: "2026-01-01T00:00:00.000Z" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "order-1", orderNo: "ob_paid", tenantId: "tenant-a", subject: "user-a", planId: "team", points: 10000, amountMinor: 9900, currency: "CNY", status: "paid", idempotencyKey: "k1", entitlements: { maxTokensPerDay: 100000, newApiGroup: "team" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z" }] }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    await expect(backend.getBillingSubscription("secret-token", "tenant-a")).resolves.toMatchObject({ planId: "team", entitlements: { maxTokensPerDay: 100000, newApiGroup: "team" } });
    await expect(backend.listBillingOrders("secret-token", "tenant-a")).resolves.toMatchObject([{ orderNo: "ob_paid", entitlements: { maxTokensPerDay: 100000, newApiGroup: "team" } }]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://resource.test/v1/tenants/tenant-a/billing/subscription", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret-token" }) }));
  });
});
