import { describe, expect, it, vi } from "vitest";
import { StripeAdapter } from "../adapters/stripe";
import type { PaymentSessionInput } from "../index";

const sampleInput: PaymentSessionInput = {
  orderNo: "ord_test_001",
  amountMinor: 9900,
  currency: "CNY",
  planId: "team",
  tenantId: "casdoor/enterprise",
  subject: "alice",
  returnUrl: "https://openbuddy.com/billing/return",
  walletId: "marketing-2026",
};

describe("StripeAdapter", () => {
  it("rejects bad secretKey", () => {
    expect(() => new StripeAdapter({ secretKey: "pk_xxx", webhookSecret: "whsec_xxx" })).toThrow(/sk_/);
  });

  it("rejects bad webhookSecret", () => {
    expect(() => new StripeAdapter({ secretKey: "sk_test_xxx", webhookSecret: "secret" })).toThrow(/whsec_/);
  });

  it("createSession POSTs to /checkout/sessions with bearer auth", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toMatch(/\/checkout\/sessions$/);
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.["Authorization"]).toMatch(/^Bearer sk_/);
      expect(headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
      const body = init?.body as string;
      expect(body).toContain("line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=cny");
      expect(body).toContain("client_reference_id=ord_test_001");
      expect(body).toContain("metadata%5BwalletId%5D=marketing-2026");
      return new Response(JSON.stringify({ id: "cs_xxx", url: "https://checkout.stripe.com/c/cs_xxx", expires_at: 1234567890 }), { status: 200 });
    });
    const adapter = new StripeAdapter({
      secretKey: "sk_test_xxx",
      webhookSecret: "whsec_xxx",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const session = await adapter.createSession(sampleInput);
    expect(session.channelSessionId).toBe("cs_xxx");
    expect(session.redirectUrl).toBe("https://checkout.stripe.com/c/cs_xxx");
    expect(session.expiresAt).toBe("2009-02-13T23:31:30.000Z");
  });

  it("createSession surfaces non-2xx errors", async () => {
    const fetchMock = vi.fn(async () => new Response("invalid_request_error", { status: 400 }));
    const adapter = new StripeAdapter({
      secretKey: "sk_test_xxx",
      webhookSecret: "whsec_xxx",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(adapter.createSession(sampleInput)).rejects.toThrow(/400/);
  });

  it("parseWebhook verifies HMAC and returns payment.succeeded", async () => {
    const secret = "whsec_test_secret_for_unit_test";
    const adapter = new StripeAdapter({
      secretKey: "sk_test_xxx",
      webhookSecret: secret,
    });
    const payload = JSON.stringify({
      id: "evt_001",
      type: "checkout.session.completed",
      created: 1700000000,
      data: {
        object: {
          client_reference_id: "ord_001",
          amount_total: 9900,
          currency: "cny",
          payment_intent: "pi_001",
          metadata: { orderNo: "ord_001", planId: "team" },
        },
      },
    });
    const t = "1700000000";
    const sig = await computeHmac(`${t}.${payload}`, secret);
    const header = `t=${t},v1=${sig}`;
    const result = await adapter.parseWebhook(payload, header);
    expect(result.event.orderNo).toBe("ord_001");
    expect(result.event.type).toBe("payment.succeeded");
    expect(result.event.amountMinor).toBe(9900);
    expect(result.event.currency).toBe("CNY");
    expect(result.event.channelPaymentId).toBe("pi_001");
    expect(result.dedupeKey).toBe("evt_001");
  });

  it("parseWebhook rejects bad signature", async () => {
    const adapter = new StripeAdapter({ secretKey: "sk_test_xxx", webhookSecret: "whsec_correct" });
    const payload = JSON.stringify({ id: "evt_bad", type: "x", created: 1, data: { object: {} } });
    await expect(adapter.parseWebhook(payload, "t=1,v1=00")).rejects.toThrow(/签名/);
  });

  it("parseWebhook maps checkout.session.expired → payment.expired", async () => {
    const secret = "whsec_xxx";
    const adapter = new StripeAdapter({ secretKey: "sk_test_xxx", webhookSecret: secret });
    const payload = JSON.stringify({
      id: "evt_exp",
      type: "checkout.session.expired",
      created: 1700000001,
      data: { object: { client_reference_id: "ord_002", metadata: { orderNo: "ord_002" } } },
    });
    const t = "1700000001";
    const sig = await computeHmac(`${t}.${payload}`, secret);
    const result = await adapter.parseWebhook(payload, `t=${t},v1=${sig}`);
    expect(result.event.type).toBe("payment.expired");
  });

  it("parseWebhook maps charge.refunded → payment.refunded", async () => {
    const secret = "whsec_xxx";
    const adapter = new StripeAdapter({ secretKey: "sk_test_xxx", webhookSecret: secret });
    const payload = JSON.stringify({
      id: "evt_rf",
      type: "charge.refunded",
      created: 1700000002,
      data: {
        object: {
          id: "ch_001",
          amount_refunded: 9900,
          payment_intent: "pi_001",
          metadata: { orderNo: "ord_003" },
        },
      },
    });
    const t = "1700000002";
    const sig = await computeHmac(`${t}.${payload}`, secret);
    const result = await adapter.parseWebhook(payload, `t=${t},v1=${sig}`);
    expect(result.event.type).toBe("payment.refunded");
    expect(result.event.amountMinor).toBe(9900);
    expect(result.event.channelPaymentId).toBe("pi_001");
  });

  it("parseWebhook maps payment_intent.payment_failed → payment.failed", async () => {
    const secret = "whsec_xxx";
    const adapter = new StripeAdapter({ secretKey: "sk_test_xxx", webhookSecret: secret });
    const payload = JSON.stringify({
      id: "evt_fail",
      type: "payment_intent.payment_failed",
      created: 1700000003,
      data: {
        object: {
          failure_message: "card_declined",
          metadata: { orderNo: "ord_004" },
        },
      },
    });
    const t = "1700000003";
    const sig = await computeHmac(`${t}.${payload}`, secret);
    const result = await adapter.parseWebhook(payload, `t=${t},v1=${sig}`);
    expect(result.event.type).toBe("payment.failed");
    expect(result.event.failureReason).toBe("card_declined");
  });
});

async function computeHmac(message: string, secret: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret).update(message).digest("hex");
}
