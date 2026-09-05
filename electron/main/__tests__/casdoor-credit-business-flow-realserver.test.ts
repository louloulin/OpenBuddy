// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CasdoorResourceBackend } from "@openbuddy/auth-casdoor";

interface ServerState {
  balance: number;
  reserved: number;
  available: number;
  lifetimeGranted: number;
  lifetimeConsumed: number;
  lifetimeRefunded: number;
  lifetimeExpired: number;
  version: number;
}

interface LedgerEntry {
  id: string;
  tenantId: string;
  subject: string;
  amount: number;
  type: string;
  reason: string;
  occurredAt: string;
  reservationKey: string;
  balanceAfter: number;
}

let server: Server;
let baseUrl = "";

const state: ServerState = {
  balance: 100,
  reserved: 0,
  available: 100,
  lifetimeGranted: 100,
  lifetimeConsumed: 0,
  lifetimeRefunded: 0,
  lifetimeExpired: 0,
  version: 1,
};
const ledger: LedgerEntry[] = [];
const reservations = new Map<string, { amount: number; model?: string }>();

function recomputeAvailable(): void {
  state.available = state.balance - state.reserved;
}

function snapshot() {
  recomputeAvailable();
  return {
    tenantId: "tenant-a",
    subject: "user-a",
    plan: "free",
    ...state,
    updatedAt: new Date().toISOString(),
  };
}

async function startServer(): Promise<void> {
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const urlPath = (req.url ?? "/").split("?")[0];
    res.setHeader("content-type", "application/json");

    const ok = (data: unknown) => {
      res.statusCode = 200;
      res.end(JSON.stringify({ data }));
    };

    if (req.method === "GET" && urlPath === "/v1/tenants/tenant-a/credits") {
      ok(snapshot());
      return;
    }
    if (req.method === "POST" && urlPath === "/v1/tenants/tenant-a/credits/grant") {
      const params = JSON.parse(body) as { subject?: string; amount: number; idempotencyKey: string };
      state.balance += params.amount;
      state.available = state.balance - state.reserved;
      state.lifetimeGranted += params.amount;
      state.version += 1;
      const entry: LedgerEntry = {
        id: `ledger-${ledger.length + 1}`, tenantId: "tenant-a", subject: params.subject ?? "user-a",
        amount: params.amount, type: "grant", reason: "test-grant",
        occurredAt: new Date().toISOString(), reservationKey: "", balanceAfter: state.balance,
      };
      ledger.push(entry);
      ok({ account: snapshot(), entry });
      return;
    }
    if (req.method === "POST" && urlPath === "/v1/tenants/tenant-a/credits/reserve") {
      const params = JSON.parse(body) as { amount: number; idempotencyKey: string; model?: string };
      if (state.available < params.amount) {
        res.statusCode = 409;
        res.end(JSON.stringify({ status: "error", code: "INSUFFICIENT_BALANCE", message: "not enough" }));
        return;
      }
      state.reserved += params.amount;
      state.available = state.balance - state.reserved;
      state.version += 1;
      const reservationKey = `rsv-${reservations.size + 1}`;
      reservations.set(reservationKey, { amount: params.amount, model: params.model });
      const entry: LedgerEntry = {
        id: `ledger-${ledger.length + 1}`, tenantId: "tenant-a", subject: "user-a",
        amount: -params.amount, type: "reserve", reason: "inference",
        occurredAt: new Date().toISOString(), reservationKey, balanceAfter: state.available,
      };
      ledger.push(entry);
      ok({ account: snapshot(), entry });
      return;
    }
    if (req.method === "POST" && urlPath === "/v1/tenants/tenant-a/credits/settle") {
      const params = JSON.parse(body) as { reservationKey: string; amount: number };
      const rsv = reservations.get(params.reservationKey);
      if (!rsv) {
        res.statusCode = 404;
        res.end(JSON.stringify({ status: "error", code: "RESERVATION_NOT_FOUND", message: "no such rsv" }));
        return;
      }
      if (params.amount > rsv.amount) {
        res.statusCode = 409;
        res.end(JSON.stringify({ status: "error", code: "SETTLE_OVERFLOW", message: "settle exceeds reserved" }));
        return;
      }
      const refund = rsv.amount - params.amount;
      state.reserved -= params.amount;
      state.lifetimeConsumed += params.amount;
      state.lifetimeRefunded += Math.max(0, refund);
      state.version += 1;
      const entry: LedgerEntry = {
        id: `ledger-${ledger.length + 1}`, tenantId: "tenant-a", subject: "user-a",
        amount: -params.amount, type: "settle", reason: "inference-settle",
        occurredAt: new Date().toISOString(), reservationKey: params.reservationKey,
        balanceAfter: state.balance - state.reserved,
      };
      ledger.push(entry);
      // 部分结算: 仅在完全结算时删除 reservation
      if (params.amount === rsv.amount) {
        reservations.delete(params.reservationKey);
      } else {
        rsv.amount -= params.amount; // 剩余量
      }
      ok({ account: snapshot(), entry, refunded: refund });
      return;
    }
    if (req.method === "POST" && urlPath === "/v1/tenants/tenant-a/credits/release") {
      const params = JSON.parse(body) as { reservationKey: string };
      const rsv = reservations.get(params.reservationKey);
      if (!rsv) {
        res.statusCode = 404;
        res.end(JSON.stringify({ status: "error", code: "RESERVATION_NOT_FOUND", message: "no such rsv" }));
        return;
      }
      const remaining = rsv.amount;
      state.reserved -= remaining;
      state.lifetimeRefunded += remaining;
      state.version += 1;
      const entry: LedgerEntry = {
        id: `ledger-${ledger.length + 1}`, tenantId: "tenant-a", subject: "user-a",
        amount: remaining, type: "release", reason: "cancel",
        occurredAt: new Date().toISOString(), reservationKey: params.reservationKey,
        balanceAfter: state.balance - state.reserved,
      };
      ledger.push(entry);
      reservations.delete(params.reservationKey);
      ok({ account: snapshot(), entry, refunded: remaining });
      return;
    }
    if (req.method === "GET" && urlPath === "/v1/tenants/tenant-a/credits/ledger") {
      ok(ledger);
      return;
    }
    if (req.method === "GET" && urlPath === "/v1/tenants/tenant-a/credits/reconciliation") {
      ok({
        source: "openbuddy-credit-ledger",
        externalNewApiCostFetched: false,
        tenantId: "tenant-a",
        generatedAt: new Date().toISOString(),
        reportId: "rpt-biz",
        reportHash: "bizhash",
        scope: "tenant",
        total: {
          requests: ledger.filter((l) => l.type === "settle").length,
          promptTokens: 0, completionTokens: 0, totalTokens: 0,
          pointsSettled: state.lifetimeConsumed,
          upstreamCost: 0, upstreamCostEntries: 0,
        },
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ status: "error", code: "NOT_FOUND", message: `${req.method} ${urlPath}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

beforeAll(async () => {
  await startServer();
});

const originalState = { ...state };
const originalLedger = [...ledger];

function resetState(): void {
  Object.assign(state, originalState);
  ledger.length = 0;
  ledger.push(...originalLedger);
  reservations.clear();
}

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Casdoor 信用业务流: 真实 HTTP 服务器端到端 (无 mock)", () => {
  beforeEach(() => {
    resetState();
  });
  it("完整生命周期: grant → reserve → settle → reconcile 状态一致性", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);

    // Step 1: 初始状态
    const initial = await backend.getCredits("token", "tenant-a");
    expect(initial.balance).toBe(100);
    expect(initial.reserved).toBe(0);
    expect(initial.available).toBe(100);

    // Step 2: grant +50 credits
    const grant = await backend.grantCredits("token", "tenant-a", {
      subject: "user-a", amount: 50, idempotencyKey: "grant-1",
    });
    expect(grant.account.balance).toBe(150);
    expect(grant.account.available).toBe(150);
    expect(grant.entry.amount).toBe(50);
    expect(grant.entry.type).toBe("grant");

    // Step 3: reserve 30 credits (用于推理)
    const reserve = await backend.reserveCredits("token", "tenant-a", {
      amount: 30, model: "deepseek-chat", idempotencyKey: "rsv-key-1",
    });
    expect(reserve.account.balance).toBe(150); // 余额不变
    expect(reserve.account.reserved).toBe(30);
    expect(reserve.account.available).toBe(120); // 可用 = 余额 - 保留
    expect(reserve.entry.amount).toBe(-30);
    expect(reserve.entry.type).toBe("reserve");
    const reservationKey = (reserve.entry as unknown as { reservationKey: string }).reservationKey;

    // Step 4: query credits — 应该显示已保留 30
    const afterReserve = await backend.getCredits("token", "tenant-a");
    expect(afterReserve.reserved).toBe(30);
    expect(afterReserve.available).toBe(120);

    // Step 5: settle 25 of 30 reserved (实际消耗 25, 退还 5)
    const settle = await backend.settleCredits("token", "tenant-a", {
      reservationKey, amount: 25, model: "deepseek-chat",
    });
    expect(settle.account.reserved).toBe(5); // 还有 5 待处理
    expect(settle.account.lifetimeConsumed).toBe(25);
    expect(settle.account.lifetimeRefunded).toBe(5);
    expect(settle.refunded).toBe(5);

    // Step 6: release 剩余 5
    const release = await backend.releaseCredits("token", "tenant-a", reservationKey);
    expect(release.account.reserved).toBe(0);
    expect(release.account.lifetimeRefunded).toBe(10); // 5 + 5
    expect(release.refunded).toBe(5);

    // Step 7: query ledger — 应该有 5 条 (grant, reserve, settle, release + initial?) 
    const ledgerResult = await backend.listCreditLedger("token", "tenant-a", 100, "user-a");
    expect(ledgerResult.length).toBeGreaterThanOrEqual(4);
    const types = ledgerResult.map((entry) => entry.type);
    expect(types).toContain("grant");
    expect(types).toContain("reserve");
    expect(types).toContain("settle");
    expect(types).toContain("release");

    // Step 8: reconcile 报告应包含正确的 lifetime 统计
    const report = await backend.getCreditReconciliation("token", "tenant-a");
    expect(report.total.pointsSettled).toBe(25); // lifetime consumed

    // Step 9: 最终状态: balance 150, reserved 0, available 150
    const final = await backend.getCredits("token", "tenant-a");
    expect(final.balance).toBe(150);
    expect(final.reserved).toBe(0);
    expect(final.available).toBe(150);
    expect(final.lifetimeGranted).toBe(150); // 100 + 50
    expect(final.lifetimeConsumed).toBe(25);
    expect(final.lifetimeRefunded).toBe(10); // 5 (settle refund) + 5 (release)
  });

  it("余额不足时 reserve 返回稳定错误码且状态不变", async () => {
    // 临时清空账户
    state.balance = 5;
    state.reserved = 0;
    state.available = 5;
    state.version += 1;
    const beforeReserved = state.reserved;

    const backend = new CasdoorResourceBackend(baseUrl);
    await expect(
      backend.reserveCredits("token", "tenant-a", {
        amount: 100, idempotencyKey: "rsv-overdraft",
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE", statusCode: 409 });

    expect(state.reserved).toBe(beforeReserved);
    // 恢复初始余额
    state.balance = 150;
    state.available = 150;
  });

  it("结算不存在的 reservationKey 返回稳定错误码", async () => {
    const backend = new CasdoorResourceBackend(baseUrl);
    await expect(
      backend.settleCredits("token", "tenant-a", {
        reservationKey: "rsv-nonexistent", amount: 10,
      })
    ).rejects.toMatchObject({ code: "RESERVATION_NOT_FOUND", statusCode: 404 });
  });
});
