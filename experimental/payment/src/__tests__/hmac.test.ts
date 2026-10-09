import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { HmacGenericAdapter } from "../adapters/hmac";

describe("HmacGenericAdapter", () => {
  const secret = "0123456789abcdef0123456789abcdef"; // 32 chars
  const now = 1_700_000_000_000;

  it("rejects short secret", () => {
    expect(() => new HmacGenericAdapter({ secret: "short" })).toThrow(/32 字符/);
  });

  it("createSession returns orderNo as sessionId + local URL", async () => {
    const adapter = new HmacGenericAdapter({ secret, now: () => now });
    const session = await adapter.createSession({
      orderNo: "ord_local_001",
      amountMinor: 1000,
      currency: "USD",
      planId: "team",
      tenantId: "casdoor/enterprise",
      subject: "alice",
      returnUrl: "https://example.com/return",
    });
    expect(session.channelSessionId).toBe("ord_local_001");
    expect(session.redirectUrl).toMatch(/ord_local_001/);
  });

  it("parseWebhook verifies signature and returns event", async () => {
    const adapter = new HmacGenericAdapter({ secret, now: () => now });
    const payload = JSON.stringify({
      id: "evt_001",
      type: "payment.succeeded",
      orderNo: "ord_001",
      amount: 9900,
      timestamp: now,
    });
    const sig = createHmac("sha256", secret).update(`${now}.${payload}`).digest("hex");
    const header = `t=${now},sha256=${sig}`;
    const result = await adapter.parseWebhook(payload, header);
    expect(result.event.orderNo).toBe("ord_001");
    expect(result.event.type).toBe("payment.succeeded");
    expect(result.dedupeKey).toBe("evt_001");
  });

  it("parseWebhook rejects bad signature", async () => {
    const adapter = new HmacGenericAdapter({ secret, now: () => now });
    const payload = JSON.stringify({ id: "evt_002", type: "x", orderNo: "ord_x" });
    await expect(adapter.parseWebhook(payload, "t=1,sha256=00")).rejects.toThrow(/签名/);
  });

  it("parseWebhook rejects stale timestamp", async () => {
    const adapter = new HmacGenericAdapter({ secret, now: () => now, timestampToleranceMs: 1000 });
    const stale = now - 5000;
    const payload = JSON.stringify({ id: "evt_003", type: "x", orderNo: "ord_y" });
    const sig = createHmac("sha256", secret).update(`${stale}.${payload}`).digest("hex");
    await expect(adapter.parseWebhook(payload, `t=${stale},sha256=${sig}`)).rejects.toThrow(/时间戳漂移/);
  });

  it("parseWebhook accepts unsigned payload (no timestamp)", async () => {
    const adapter = new HmacGenericAdapter({ secret, now: () => now });
    const payload = JSON.stringify({ id: "evt_004", type: "payment.succeeded", orderNo: "ord_z" });
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    const result = await adapter.parseWebhook(payload, `sha256=${sig}`);
    expect(result.event.orderNo).toBe("ord_z");
  });

  it("parseWebhook rejects payload missing orderNo", async () => {
    const adapter = new HmacGenericAdapter({ secret, now: () => now });
    const payload = JSON.stringify({ id: "evt_005", type: "x" });
    const sig = createHmac("sha256", secret).update(`${now}.${payload}`).digest("hex");
    await expect(adapter.parseWebhook(payload, `t=${now},sha256=${sig}`)).rejects.toThrow(/orderNo/);
  });
});
