import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TestBrowserWindow = { isDestroyed: () => boolean; webContents: { send: (...args: unknown[]) => unknown } };

const { sendMock, casdoorAuthMock, electronMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  casdoorAuthMock: {
    status: vi.fn(),
    getAccessToken: vi.fn(),
    authorize: vi.fn(() => true),
    refresh: vi.fn(async () => undefined),
    handleExternalRevocation: vi.fn(async () => undefined),
  },
  electronMock: {
    app: { getPath: () => "/tmp/openbuddy-resources-test" },
    BrowserWindow: { getAllWindows: vi.fn<() => TestBrowserWindow[]>(() => []) },
  },
}));
const broadcastWindow = {
  isDestroyed: () => false,
  webContents: { send: sendMock },
};
const destroyedWindow = {
  isDestroyed: () => true,
  webContents: { send: vi.fn() },
};

electronMock.BrowserWindow.getAllWindows.mockReturnValue([broadcastWindow, destroyedWindow]);

vi.mock("electron", () => electronMock);
vi.mock("./casdoor-auth", () => ({ casdoorAuth: casdoorAuthMock }));
vi.mock("./casdoor-audit", () => ({ casdoorAudit: { record: vi.fn(async () => undefined) } }));

import { __casdoorResourceTestables } from "./casdoor-resources";
import { CasdoorResourceBackend } from "@openbuddy/auth-casdoor";

const { CasdoorResourceService } = __casdoorResourceTestables;

function createService() {
  const service = new CasdoorResourceService();
  return service;
}

function createAuthStatus(subject: string, activeTenantId = "tenant-a") {
  return {
    status: "signed_in" as const,
    config: { configured: true },
    tenantContext: { activeTenantId },
    identity: { subject },
  };
}

describe("CasdoorResourceService.deliverCasdoorWebhook", () => {
  beforeEach(() => {
    sendMock.mockClear();
    casdoorAuthMock.status.mockReset();
    casdoorAuthMock.getAccessToken.mockReset();
    casdoorAuthMock.authorize.mockReset();
    casdoorAuthMock.refresh.mockClear();
    casdoorAuthMock.handleExternalRevocation.mockClear();
    electronMock.BrowserWindow.getAllWindows.mockClear();
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([broadcastWindow, destroyedWindow]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a local fallback when no remote backend is configured", async () => {
    const service = createService();
    service.setBackendFactory(() => null);
    const result = await service.deliverCasdoorWebhook({ type: "user", action: "update", organization: "tenant-a", user: "alice" }, "secret");
    expect(result).toEqual({ received: "user", action: "update", impacted: [] });
    expect(casdoorAuthMock.refresh).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("forwards the webhook to the remote backend with HMAC signature", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { received: "user.update", action: "update", impacted: ["tenant-a/alice"] } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    const service = createService();
    service.setBackendFactory(() => backend);
    casdoorAuthMock.status.mockReturnValue(createAuthStatus("admin"));
    casdoorAuthMock.getAccessToken.mockReturnValue("access-token");

    const result = await service.deliverCasdoorWebhook({ type: "user", action: "update", organization: "tenant-a", user: "alice" }, "secret");

    expect(result).toEqual({ received: "user.update", action: "update", impacted: ["tenant-a/alice"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://resource.test/v1/webhooks/casdoor");
    expect(init.method).toBe("POST");
    expect(init.headers["x-casdoor-signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(init.body).toContain('"type":"user"');
    expect(casdoorAuthMock.refresh).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith("casdoor://casdoor-webhook", expect.objectContaining({ type: "user", action: "update", organization: "tenant-a", user: "alice", impacted: ["tenant-a/alice"], at: expect.any(String) }));
  });

  it("does not refresh the auth session when no membership is impacted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { received: "role.update", action: "update", impacted: [] } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    const service = createService();
    service.setBackendFactory(() => backend);
    casdoorAuthMock.status.mockReturnValue(createAuthStatus("admin"));
    casdoorAuthMock.getAccessToken.mockReturnValue("access-token");

    await service.deliverCasdoorWebhook({ type: "role", action: "update", organization: "tenant-a", role: "viewer" }, "secret");

    expect(casdoorAuthMock.refresh).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("survives backend failures without breaking the renderer contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "error", code: "WEBHOOK_SIGNATURE_INVALID", message: "bad sig" }), { status: 401 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    const service = createService();
    service.setBackendFactory(() => backend);
    casdoorAuthMock.status.mockReturnValue(createAuthStatus("admin"));
    casdoorAuthMock.getAccessToken.mockReturnValue("access-token");

    await expect(service.deliverCasdoorWebhook({ type: "user", action: "delete", organization: "tenant-a", user: "alice" }, "wrong-secret")).rejects.toThrow("Webhook 投递失败：401");
    expect(casdoorAuthMock.refresh).not.toHaveBeenCalled();
  });

  it("skips destroyed windows when broadcasting the webhook event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { received: "user.update", action: "update", impacted: ["tenant-a/alice"] } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    const service = createService();
    service.setBackendFactory(() => backend);
    casdoorAuthMock.status.mockReturnValue(createAuthStatus("admin"));
    casdoorAuthMock.getAccessToken.mockReturnValue("access-token");

    await service.deliverCasdoorWebhook({ type: "user", action: "update", organization: "tenant-a", user: "alice" }, "secret");

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
  });
});
describe("CasdoorResourceService billing", () => {
  beforeEach(() => {
    sendMock.mockClear();
    casdoorAuthMock.status.mockReset();
    casdoorAuthMock.getAccessToken.mockReset();
    casdoorAuthMock.authorize.mockReset().mockReturnValue(true);
    casdoorAuthMock.refresh.mockClear();
    casdoorAuthMock.handleExternalRevocation.mockClear();
    electronMock.BrowserWindow.getAllWindows.mockClear();
  });

  it("rejects billing plan listing without read permission", async () => {
    const backend = new CasdoorResourceBackend("https://resource.test", vi.fn());
    const service = createService();
    service.setBackendFactory(() => backend);
    casdoorAuthMock.status.mockReturnValue(createAuthStatus("viewer"));
    casdoorAuthMock.getAccessToken.mockReturnValue("access-token");
    casdoorAuthMock.authorize.mockReturnValue(false);
    await expect(service.listBillingPlans()).rejects.toThrow("当前账户没有积分权限");
  });

  it("forwards billing plan listing through the configured backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "free", name: "Free", currency: "CNY", priceMinor: 0, points: 100, active: true, features: [], updatedAt: "2026-01-01T00:00:00.000Z" },
    ] }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    const service = createService();
    service.setBackendFactory(() => backend);
    casdoorAuthMock.status.mockReturnValue(createAuthStatus("admin"));
    casdoorAuthMock.getAccessToken.mockReturnValue("access-token");
    const plans = await service.listBillingPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0]?.id).toBe("free");
    expect(fetchMock).toHaveBeenCalledWith("https://resource.test/v1/tenants/tenant-a/billing/plans", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer access-token" }) }));
  });

  it("rejects billing plan upserts without catalog write permission", async () => {
    const backend = new CasdoorResourceBackend("https://resource.test", vi.fn());
    const service = createService();
    service.setBackendFactory(() => backend);
    casdoorAuthMock.status.mockReturnValue(createAuthStatus("viewer"));
    casdoorAuthMock.getAccessToken.mockReturnValue("access-token");
    casdoorAuthMock.authorize.mockImplementation(() => false);
    await expect(service.upsertBillingPlan({ id: "team", name: "Team" })).rejects.toThrow("当前账户没有套餐目录写权限");
  });

  it("creates, refunds, and expires billing orders through the gateway", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "order-1", orderNo: "ob_1", tenantId: "tenant-a", subject: "user-a", planId: "team", points: 10000, amountMinor: 9900, currency: "CNY", status: "pending", idempotencyKey: "k1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z" } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "order-1", orderNo: "ob_1", tenantId: "tenant-a", subject: "user-a", planId: "team", points: 10000, amountMinor: 9900, currency: "CNY", status: "refunded", idempotencyKey: "k1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z", refundedAt: "2026-01-02T00:00:00.000Z" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "order-1", orderNo: "ob_1", tenantId: "tenant-a", subject: "user-a", planId: "team", points: 10000, amountMinor: 9900, currency: "CNY", status: "expired", idempotencyKey: "k1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z" } }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock);
    const service = createService();
    service.setBackendFactory(() => backend);
    casdoorAuthMock.status.mockReturnValue(createAuthStatus("user-a"));
    casdoorAuthMock.getAccessToken.mockReturnValue("access-token");
    casdoorAuthMock.authorize.mockImplementation(() => true);

    const created = await service.createBillingOrder({ planId: "team", idempotencyKey: "k1" });
    expect(created).toMatchObject({ orderNo: "ob_1", status: "pending" });

    const refunded = await service.refundBillingOrder("ob_1");
    expect(refunded).toMatchObject({ orderNo: "ob_1", status: "refunded" });

    const expired = await service.expireBillingOrder("ob_1");
    expect(expired).toMatchObject({ orderNo: "ob_1", status: "expired" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://resource.test/v1/tenants/tenant-a/billing/orders", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://resource.test/v1/tenants/tenant-a/billing/orders/ob_1/refund", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://resource.test/v1/tenants/tenant-a/billing/orders/ob_1/expire", expect.objectContaining({ method: "POST" }));
  });

  it("rejects billing operations when the gateway backend is not configured", async () => {
    const service = createService();
    service.setBackendFactory(() => null);
    casdoorAuthMock.status.mockReturnValue(createAuthStatus("admin"));
    await expect(service.listBillingPlans()).rejects.toThrow("企业积分账本尚未启用");
    await expect(service.createBillingOrder({ planId: "team" })).rejects.toThrow("企业积分账本尚未启用");
    await expect(service.refundBillingOrder("ob_1")).rejects.toThrow("企业积分账本尚未启用");
    await expect(service.expireBillingOrder("ob_1")).rejects.toThrow("企业积分账本尚未启用");
  });

  it("rejects billing orders without a plan identifier", async () => {
    const backend = new CasdoorResourceBackend("https://resource.test", vi.fn());
    const service = createService();
    service.setBackendFactory(() => backend);
    casdoorAuthMock.status.mockReturnValue(createAuthStatus("admin"));
    casdoorAuthMock.getAccessToken.mockReturnValue("access-token");
    await expect(service.createBillingOrder({ planId: "" })).rejects.toThrow("套餐 ID 不能为空");
    await expect(service.createBillingOrder({ planId: "   " })).rejects.toThrow("套餐 ID 不能为空");
    await expect(service.refundBillingOrder("")).rejects.toThrow("订单号不能为空");
    await expect(service.expireBillingOrder("")).rejects.toThrow("订单号不能为空");
  });
});
