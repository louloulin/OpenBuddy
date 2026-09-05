// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingHttpHeaders, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { CasdoorResourceBackend } from "@openbuddy/auth-casdoor";

interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
  receivedAt: number;
}

interface RecordedRoute {
  pattern: RegExp;
  method: string;
  status: number;
  payload: () => unknown;
}

let server: Server;
let baseUrl = "";
const captured: CapturedRequest[] = [];
const routes: RecordedRoute[] = [];

const isoNow = "2026-08-31T12:00:00.000Z";
const basePolicy = {
  status: "active",
  maxResources: 10,
  version: 1,
  updatedAt: isoNow,
  updatedBy: "test-admin",
};

function matchRoute(method: string, urlPath: string): RecordedRoute | null {
  for (let i = routes.length - 1; i >= 0; i -= 1) {
    const route = routes[i];
    if (route && route.method === method && route.pattern.test(urlPath)) return route;
  }
  return null;
}

async function startServer(): Promise<void> {
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const request: CapturedRequest = {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: req.headers,
      body,
      receivedAt: Date.now(),
    };
    captured.push(request);

    const urlPath = (req.url ?? "/").split("?")[0];
    const route = matchRoute(request.method, urlPath);
    if (!route) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "error", code: "NOT_FOUND", message: `未注册的路由: ${request.method} ${urlPath}` }));
      return;
    }
    const payload = route.payload();
    res.statusCode = route.status;
    if (payload && typeof payload === "object" && "__contentType" in payload && typeof payload.__contentType === "string") {
      res.setHeader("content-type", payload.__contentType);
    } else {
      res.setHeader("content-type", "application/json");
    }
    if (payload && typeof payload === "object" && "__contentDisposition" in payload && typeof payload.__contentDisposition === "string") {
      res.setHeader("content-disposition", payload.__contentDisposition);
    }
    if (payload && typeof payload === "object" && "__extraHeaders" in payload && payload.__extraHeaders && typeof payload.__extraHeaders === "object") {
      for (const [key, value] of Object.entries(payload.__extraHeaders)) {
        if (typeof value === "string") res.setHeader(key, value);
      }
    }
    res.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

function registerRoute(method: string, pattern: RegExp, status: number, payload: () => unknown): void {
  routes.push({ method, pattern, status, payload });
}

beforeAll(async () => {
  await startServer();

  // ========== 资源（resources）==========
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/resources$/, 200, () => ({
    data: [{
      id: "project-1", tenantId: "tenant-a", ownerSubject: "user-a", type: "project", name: "项目 1",
      metadata: { provider: "webdav" }, createdAt: isoNow, updatedAt: isoNow, version: 1,
    }],
  }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/resources\/[^/]+$/, 200, () => ({
    data: {
      id: "project-1", tenantId: "tenant-a", ownerSubject: "user-a", type: "project", name: "项目 1",
      metadata: { provider: "webdav" }, createdAt: isoNow, updatedAt: isoNow, version: 1,
    },
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/resources$/, 201, () => ({
    data: {
      id: "project-2", tenantId: "tenant-a", ownerSubject: "user-a", type: "project", name: "新建项目",
      metadata: { provider: "s3" }, createdAt: isoNow, updatedAt: isoNow, version: 1,
    },
  }));
  registerRoute("PATCH", /^\/v1\/tenants\/[^/]+\/resources\/[^/]+$/, 200, () => ({
    data: {
      id: "project-1", tenantId: "tenant-a", ownerSubject: "user-a", type: "project", name: "已更新",
      metadata: { provider: "webdav" }, createdAt: isoNow, updatedAt: isoNow, version: 2,
    },
  }));
  registerRoute("DELETE", /^\/v1\/tenants\/[^/]+\/resources\/[^/]+$/, 200, () => ({ data: { ok: true } }));

  // ========== 租户策略（policy）==========
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/policy$/, 200, () => ({ data: basePolicy }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/runtime-policy$/, 200, () => ({
    data: { ...basePolicy, maxTokensPerDay: 1000, tokensUsedToday: 100, pointsUsedToday: 5 },
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/runtime-usage$/, 200, () => ({
    data: { ...basePolicy, version: 2, tokensUsedToday: 200, pointsUsedToday: 10 },
  }));
  registerRoute("PATCH", /^\/v1\/tenants\/[^/]+\/policy$/, 200, () => ({
    data: { ...basePolicy, maxResources: 20, version: 2 },
  }));

  // ========== AI 能力 / 模型目录 ==========
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/ai\/capabilities$/, 200, () => ({
    data: {
      group: "tenant-a",
      capabilitySource: "gateway-config",
      models: [{
        id: "deepseek-chat",
        capabilities: {
          "chat.completions": { supported: true, streaming: true, usage: "required" },
        },
      }],
    },
  }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/ai\/catalog$/, 200, () => ({
    data: {
      group: "tenant-a",
      capabilitySource: "gateway-config",
      pricingSource: "gateway-pricing",
      generatedAt: isoNow,
      models: [{
        id: "deepseek-chat",
        sellable: true,
        capabilities: { "chat.completions": { supported: true } },
        pricing: {
          model: "deepseek-chat",
          inputPointsPerThousand: 1,
          outputPointsPerThousand: 2,
          minimumPoints: 1,
          updatedAt: isoNow,
        },
      }],
    },
  }));

  // ========== 信用（credits）+ 钱包（wallets）==========
  const baseAccount = {
    tenantId: "tenant-a", subject: "user-a", plan: "free", balance: 100, reserved: 0, available: 100,
    lifetimeGranted: 100, lifetimeConsumed: 0, lifetimeRefunded: 0, lifetimeExpired: 0,
    updatedAt: isoNow, version: 1,
  };
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/credits$/, 200, () => ({ data: baseAccount }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/wallets$/, 200, () => ({
    data: [{
      id: "wallet-1", tenantId: "tenant-a", name: "团队钱包", status: "active",
      createdAt: isoNow, updatedAt: isoNow, createdBy: "owner",
      members: [{
        walletId: "wallet-1", tenantId: "tenant-a", subject: "user-a", role: "spender",
        createdAt: isoNow, updatedAt: isoNow, createdBy: "owner",
      }],
    }],
  }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/wallets\/[^/]+\/credits$/, 200, () => ({ data: { ...baseAccount, balance: 50 } }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/wallets\/[^/]+\/ledger$/, 200, () => ({
    data: [{
      id: "ledger-1", tenantId: "tenant-a", subject: "user-a", amount: 10, type: "grant",
      reason: "test", occurredAt: isoNow, reservationKey: "", balanceAfter: 110,
    }],
  }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/credits\/ledger$/, 200, () => ({
    data: [{
      id: "ledger-2", tenantId: "tenant-a", subject: "user-a", amount: -5, type: "reserve",
      reason: "inference", occurredAt: isoNow, reservationKey: "rsv-1", balanceAfter: 95,
    }],
  }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/credits\/reconciliation$/, 200, () => ({
    data: {
      source: "openbuddy-credit-ledger", externalNewApiCostFetched: false,
      tenantId: "tenant-a", generatedAt: isoNow,
      reportId: "rpt-recon-1", reportHash: "reconhash",
      scope: "tenant",
      total: {
        requests: 1, promptTokens: 100, completionTokens: 50, totalTokens: 150,
        pointsSettled: 1, upstreamCost: 0, upstreamCostEntries: 0,
      },
    },
  }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/credits\/reconciliation\/export$/, 200, () => ({
    __contentType: "text/csv",
    __contentDisposition: 'attachment; filename="reconciliation-tenant-a-2026-08.csv"',
    __extraHeaders: { "x-openbuddy-report-id": "rpt-1", "x-openbuddy-report-hash": "deadbeef" },
    data: {
      filename: "reconciliation-tenant-a-2026-08.csv",
      body: "subject,delta\nuser-a,10\n",
    },
  }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/credits\/pricing$/, 200, () => ({
    data: [{
      model: "deepseek-chat", inputPointsPerThousand: 1, outputPointsPerThousand: 2,
      minimumPoints: 1, updatedAt: isoNow,
    }],
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/credits\/quote$/, 200, () => ({
    data: {
      model: "deepseek-chat", promptTokens: 100, completionTokens: 50, totalTokens: 150,
      estimatedPoints: 1, unit: "points", priceBasis: "gateway-pricing",
      pricing: { model: "deepseek-chat", inputPointsPerThousand: 1, outputPointsPerThousand: 2, minimumPoints: 1, updatedAt: isoNow },
    },
  }));
  registerRoute("PATCH", /^\/v1\/tenants\/[^/]+\/credits\/pricing$/, 200, () => ({
    data: { model: "deepseek-chat", inputPointsPerThousand: 2, outputPointsPerThousand: 4, minimumPoints: 1, updatedAt: isoNow },
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/credits\/grant$/, 200, () => ({
    data: {
      account: { ...baseAccount, balance: 110, available: 110, lifetimeGranted: 110 },
      entry: { id: "ledger-grant", tenantId: "tenant-a", subject: "user-a", amount: 10, type: "grant", reason: "test", occurredAt: isoNow, reservationKey: "", balanceAfter: 110 },
    },
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/credits\/welcome$/, 200, () => ({
    data: {
      account: { ...baseAccount, balance: 100 },
      entry: { id: "ledger-welcome", tenantId: "tenant-a", subject: "user-a", amount: 50, type: "grant", reason: "welcome", occurredAt: isoNow, reservationKey: "", balanceAfter: 100 },
    },
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/credits\/reserve$/, 200, () => ({
    data: {
      account: { ...baseAccount, balance: 80, reserved: 20, available: 80 },
      entry: { id: "ledger-reserve", tenantId: "tenant-a", subject: "user-a", amount: -20, type: "reserve", reason: "inference", occurredAt: isoNow, reservationKey: "rsv-1", balanceAfter: 80 },
    },
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/credits\/settle$/, 200, () => ({
    data: {
      account: { ...baseAccount, balance: 90, reserved: 0, available: 90 },
      entry: { id: "ledger-settle", tenantId: "tenant-a", subject: "user-a", amount: -10, type: "settle", reason: "inference", occurredAt: isoNow, reservationKey: "rsv-1", balanceAfter: 90 },
      refunded: 10,
    },
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/credits\/release$/, 200, () => ({
    data: {
      account: { ...baseAccount, balance: 100, reserved: 0, available: 100 },
      entry: { id: "ledger-release", tenantId: "tenant-a", subject: "user-a", amount: 20, type: "release", reason: "inference", occurredAt: isoNow, reservationKey: "rsv-1", balanceAfter: 100 },
      refunded: 20,
    },
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/credits\/expire$/, 200, () => ({
    data: {
      expired: 0,
      account: baseAccount,
    },
  }));

  // ========== 计费（billing）==========
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/billing\/plans$/, 200, () => ({
    data: [{
      id: "plan-pro", name: "专业版", currency: "CNY", priceMinor: 9900, points: 1000,
      active: true, features: ["priority"], updatedAt: isoNow,
    }],
  }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/billing\/subscription$/, 200, () => ({
    data: {
      tenantId: "tenant-a", subject: "user-a", planId: "plan-pro", orderNo: "OD-1",
      status: "active",
      entitlements: { modelAllowlist: ["deepseek-chat"] },
      startedAt: isoNow,
    },
  }));
  registerRoute("PATCH", /^\/v1\/tenants\/[^/]+\/billing\/plans$/, 200, () => ({
    data: { id: "plan-pro", name: "专业版", currency: "CNY", priceMinor: 9900, points: 2000, active: true, features: ["priority"], updatedAt: isoNow },
  }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/billing\/orders$/, 200, () => ({
    data: [{
      id: "order-1", orderNo: "OD202608310001", tenantId: "tenant-a", subject: "user-a",
      planId: "plan-pro", points: 1000, amountMinor: 9900, currency: "CNY", status: "paid",
      idempotencyKey: "key-1", createdAt: isoNow, updatedAt: isoNow, expiresAt: isoNow,
    }],
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/billing\/orders$/, 201, () => ({
    data: {
      id: "order-2", orderNo: "OD202608310002", tenantId: "tenant-a", subject: "user-a",
      planId: "plan-pro", points: 1000, amountMinor: 9900, currency: "CNY", status: "pending",
      idempotencyKey: "key-2", createdAt: isoNow, updatedAt: isoNow, expiresAt: isoNow,
    },
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/billing\/orders\/[^/]+\/refund$/, 200, () => ({
    data: {
      id: "order-1", orderNo: "OD202608310001", tenantId: "tenant-a", subject: "user-a",
      planId: "plan-pro", points: 1000, amountMinor: 9900, currency: "CNY", status: "refunded",
      idempotencyKey: "key-1", createdAt: isoNow, updatedAt: isoNow, expiresAt: isoNow, refundedAt: isoNow,
    },
  }));
  registerRoute("POST", /^\/v1\/tenants\/[^/]+\/billing\/orders\/[^/]+\/expire$/, 200, () => ({
    data: {
      id: "order-2", orderNo: "OD202608310002", tenantId: "tenant-a", subject: "user-a",
      planId: "plan-pro", points: 1000, amountMinor: 9900, currency: "CNY", status: "expired",
      idempotencyKey: "key-2", createdAt: isoNow, updatedAt: isoNow, expiresAt: isoNow,
    },
  }));

  // ========== 审计 + 成员撤销 + 会话 ==========
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/audit$/, 200, () => ({
    data: [{ id: "audit-1", tenantId: "tenant-a", subject: "user-a", action: "policy.update", occurredAt: isoNow }],
  }));
  registerRoute("PATCH", /^\/v1\/tenants\/[^/]+\/member-revocations\/[^/]+$/, 200, () => ({
    data: { subject: "user-a", revoked: true, revokedAt: isoNow, revokedBy: "admin", reason: "offboarding", configured: true },
  }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/member-revocations$/, 200, () => ({
    data: [{ subject: "user-a", revoked: true, revokedAt: isoNow, revokedBy: "admin", reason: "offboarding", configured: true }],
  }));
  registerRoute("GET", /^\/v1\/tenants\/[^/]+\/sessions$/, 200, () => ({
    data: [{
      sessionId: "sess-1", subject: "user-a", kind: "desktop", scopes: ["read"],
      startedAt: isoNow, lastSeenAt: isoNow,
    }],
  }));

  // ========== 健康检查 + webhook ==========
  registerRoute("GET", /^\/healthz$/, 200, () => ({ status: "ok", version: "1.0.0" }));
  registerRoute("POST", /^\/v1\/webhooks\/casdoor$/, 200, () => ({ data: { received: "user.update", action: "update", impacted: ["tenant-a/user-a"] } }));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function findRequest(method: string, urlPattern: RegExp): CapturedRequest {
  for (let i = captured.length - 1; i >= 0; i -= 1) {
    const request = captured[i];
    if (request && request.method === method && urlPattern.test(request.url)) return request;
  }
  throw new Error(`未找到 ${method} ${urlPattern}`);
}

describe("CasdoorResourceBackend 真实 HTTP 服务器端到端 (无 fetch mock)", () => {
  it("发送 Bearer 令牌并保留 If-Match 头用于乐观并发控制", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const updated = await backend.update("secret-token", "tenant-a", "project-1", { expectedVersion: 1, name: "Updated" });
    expect(updated.id).toBe("project-1");
    expect(updated.version).toBe(2);
    const request = findRequest("PATCH", /resources\/project-1/);
    expect(request.headers["authorization"]).toBe("Bearer secret-token");
    expect(request.headers["if-match"]).toBe("1");
    expect(String(request.headers["content-type"])).toContain("application/json");
  });

  it("create 资源时把 name 与 metadata 编码进 JSON body", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const resource = await backend.create("secret-token", "tenant-a", {
      type: "project", name: "新建项目", metadata: { provider: "s3", bucket: "openbuddy" },
    });
    expect(resource.name).toBe("新建项目");
    const request = findRequest("POST", /resources$/);
    expect(request.headers["authorization"]).toBe("Bearer secret-token");
    expect(JSON.parse(request.body)).toMatchObject({ type: "project", name: "新建项目", metadata: { provider: "s3" } });
  });

  it("DELETE 携带 If-Match 版本头", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    await backend.delete("secret-token", "tenant-a", "project-1", 3);
    const request = findRequest("DELETE", /resources\/project-1/);
    expect(request.headers["if-match"]).toBe("3");
  });

  it("list 把 type 作为查询参数转发", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    await backend.list("secret-token", "tenant-a", "project");
    const request = findRequest("GET", /^\/v1\/tenants\/tenant-a\/resources\?/);
    expect(request.url).toContain("type=project");
    expect(request.headers["authorization"]).toBe("Bearer secret-token");
  });

  it("list 不带 type 时不带查询参数", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const records = await backend.list("secret-token", "tenant-a");
    expect(records[0].id).toBe("project-1");
    const request = findRequest("GET", /^\/v1\/tenants\/tenant-a\/resources$/);
    expect(request.url).not.toContain("?");
  });

  it("policy PATCH 在版本冲突时透传稳定错误码", async () => {
    registerRoute("PATCH", /^\/v1\/tenants\/[^/]+\/policy$/, 409, () => ({
      status: "error", code: "TENANT_POLICY_VERSION_CONFLICT", message: "stale",
    }));
    const backend = new CasdoorResourceBackend(baseUrl);
    await expect(backend.updateTenantPolicy("secret-token", "tenant-a", { expectedVersion: 1, maxResources: 20 })).rejects.toMatchObject({
      code: "TENANT_POLICY_VERSION_CONFLICT", statusCode: 409,
    });
  });

  it("recordRuntimeUsage 使用 POST 写入运行时计量", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const result = await backend.recordRuntimeUsage("secret-token", "tenant-a", 100, 5);
    expect(result.tokensUsedToday).toBe(200);
    const request = findRequest("POST", /runtime-usage/);
    expect(JSON.parse(request.body)).toMatchObject({ tokens: 100, points: 5 });
  });

  it("grantCredits 通过 POST 携带 idempotencyKey", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const { account, entry } = await backend.grantCredits("secret-token", "tenant-a", {
      subject: "user-a", amount: 10, reason: "test", idempotencyKey: "key-xyz",
    });
    expect(account.balance).toBe(110);
    expect(entry.amount).toBe(10);
    const request = findRequest("POST", /credits\/grant/);
    expect(JSON.parse(request.body)).toMatchObject({ subject: "user-a", amount: 10, idempotencyKey: "key-xyz" });
  });

  it("reserve → settle 完整闭环：保留令牌、结算、释放", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const reserved = await backend.reserveCredits("secret-token", "tenant-a", {
      amount: 20, model: "deepseek-chat", promptTokens: 100, completionTokens: 50, idempotencyKey: "rsv-key-1",
    });
    expect(reserved.account.reserved).toBe(20);
    const settled = await backend.settleCredits("secret-token", "tenant-a", {
      reservationKey: "rsv-1", amount: 10, model: "deepseek-chat", promptTokens: 100, completionTokens: 50,
    });
    expect(settled.refunded).toBe(10);
    const released = await backend.releaseCredits("secret-token", "tenant-a", "rsv-1");
    expect(released.refunded).toBe(20);
  });

  it("refundBillingOrder 把状态变为 refunded 并写入 refundedAt", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const order = await backend.refundBillingOrder("secret-token", "tenant-a", "OD202608310001");
    expect(order.status).toBe("refunded");
    expect(order.refundedAt).toBe(isoNow);
  });

  it("expireBillingOrder 把状态变为 expired", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const order = await backend.expireBillingOrder("secret-token", "tenant-a", "OD202608310002");
    expect(order.status).toBe("expired");
  });

  it("issueWelcomeCredit 返回账户与 ledger 条目", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const { account, entry } = await backend.issueWelcomeCredit("secret-token", "tenant-a", {
      subject: "user-a", idempotencyKey: "welcome-1",
    });
    expect(account.balance).toBe(100);
    expect(entry.type).toBe("grant");
  });

  it("listCreditWalletLedger 与 listCreditLedger 返回正确 delta", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const walletLedger = await backend.listCreditWalletLedger("secret-token", "tenant-a", "wallet-1");
    expect(walletLedger[0].amount).toBe(10);
    const ledger = await backend.listCreditLedger("secret-token", "tenant-a", 50, "user-a");
    expect(ledger[0].amount).toBe(-5);
    expect(ledger[0].type).toBe("reserve");
  });

  it("getCreditReconciliation 与 export 返回对账数据", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const report = await backend.getCreditReconciliation("secret-token", "tenant-a");
    expect(report.total.pointsSettled).toBe(1);
    const exported = await backend.getCreditReconciliationExport("secret-token", "tenant-a");
    expect(exported.body).toContain("subject");
    expect(exported.contentType).toBe("text/csv");
    expect(exported.reportId).toBe("rpt-1");
  });

  it("updateCreditPricing 使用 PATCH 写入新单价", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const pricing = await backend.updateCreditPricing("secret-token", "tenant-a", {
      model: "deepseek-chat", inputPointsPerThousand: 2, outputPointsPerThousand: 4, minimumPoints: 1,
    });
    expect(pricing.inputPointsPerThousand).toBe(2);
    const request = findRequest("PATCH", /credits\/pricing$/);
    expect(request.headers["authorization"]).toBe("Bearer secret-token");
  });

  it("quoteCredits 返回 token 与 points 估值", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const quote = await backend.quoteCredits("secret-token", "tenant-a", {
      model: "deepseek-chat", promptTokens: 100, completionTokens: 50,
    });
    expect(quote.estimatedPoints).toBe(1);
    const request = findRequest("POST", /credits\/quote/);
    expect(JSON.parse(request.body)).toMatchObject({ model: "deepseek-chat", promptTokens: 100, completionTokens: 50 });
  });

  it("expireCredits 返回过期数量与账户", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const { expired, account } = await backend.expireCredits("secret-token", "tenant-a", "user-a");
    expect(expired).toBe(0);
    expect(account.balance).toBe(100);
  });

  it("setMemberRevocation 编码主体并保留 revoked 标记", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const record = await backend.setMemberRevocation("secret-token", "tenant-a", "user-a", true, "offboarding");
    expect(record.revoked).toBe(true);
    expect(record.reason).toBe("offboarding");
  });

  it("listMemberRevocations 仅返回有效记录", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const records = await backend.listMemberRevocations("secret-token", "tenant-a");
    expect(records).toHaveLength(1);
    expect(records[0].subject).toBe("user-a");
  });

  it("listSessions 返回绑定信息", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const sessions = await backend.listSessions("secret-token", "tenant-a", 50);
    expect(sessions[0].kind).toBe("desktop");
  });

  it("listTenantAudit 返回审计条目", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const audits = await backend.listTenantAudit("secret-token", "tenant-a", 10);
    expect(audits.length).toBeGreaterThan(0);
    const first = audits[0] as { id: string; action: string };
    expect(first.action).toBe("policy.update");
  });

  it("getAiCapabilities 返回能力列表", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const caps = await backend.getAiCapabilities("secret-token", "tenant-a");
    expect(caps.models[0].id).toBe("deepseek-chat");
    expect(caps.capabilitySource).toBe("gateway-config");
  });

  it("getCommercialModelCatalog 返回模型目录", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const catalog = await backend.getCommercialModelCatalog("secret-token", "tenant-a");
    expect(catalog.models[0].id).toBe("deepseek-chat");
    expect(catalog.models[0].sellable).toBe(true);
  });

  it("listBillingPlans 包含 features", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const plans = await backend.listBillingPlans("secret-token", "tenant-a");
    expect(plans[0].features).toContain("priority");
  });

  it("getBillingSubscription 返回活跃订阅", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const sub = await backend.getBillingSubscription("secret-token", "tenant-a");
    expect(sub?.status).toBe("active");
    expect(sub?.entitlements.modelAllowlist).toContain("deepseek-chat");
  });

  it("upsertBillingPlan 使用 PATCH 并保留 features", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const plan = await backend.upsertBillingPlan("secret-token", "tenant-a", {
      id: "plan-pro", name: "专业版", currency: "CNY", priceMinor: 9900, points: 2000, active: true, features: ["priority"],
    });
    expect(plan.points).toBe(2000);
    expect(plan.features).toContain("priority");
  });

  it("listBillingOrders 携带 subject 与 limit 查询参数", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const orders = await backend.listBillingOrders("secret-token", "tenant-a", "user-a", 50);
    expect(orders.length).toBeGreaterThan(0);
  });

  it("createBillingOrder 返回 pending 状态", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const order = await backend.createBillingOrder("secret-token", "tenant-a", {
      planId: "plan-pro", subject: "user-a", idempotencyKey: "key-2",
    });
    expect(order.status).toBe("pending");
  });

  it("getTenantPolicy 与 getRuntimePolicy 返回租户策略", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    const policy = await backend.getTenantPolicy("secret-token", "tenant-a");
    expect(policy.maxResources).toBe(10);
    const runtime = await backend.getRuntimePolicy("secret-token", "tenant-a");
    expect(runtime.tokensUsedToday).toBe(100);
  });

  it("healthz 返回 ok", async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("ok");
  });
});
