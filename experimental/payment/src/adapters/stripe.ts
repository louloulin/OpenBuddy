/**
 * Stripe 支付通道适配器
 *
 * 适用场景：国际信用卡、Stripe Checkout、订阅（与 enterprise SKU 完美匹配）。
 * 凭据要求：
 *   - STRIPE_SECRET_KEY（sk_test_/sk_live_）
 *   - STRIPE_WEBHOOK_SECRET（whsec_）
 *
 * 实现要点：
 *   - createSession → POST https://api.stripe.com/v1/checkout/sessions
 *   - parseWebhook → 验证 Stripe-Signature 头（HMAC-SHA256，t= + v1=...）
 *   - queryOrder → GET /v1/checkout/sessions/{id}
 *   - refund → POST /v1/refunds
 *
 * 不引入 stripe-sdk 依赖：本实现只用 fetch + Web Crypto，避免 5MB+ 依赖膨胀。
 * 参考：https://stripe.com/docs/api/checkout/sessions
 */

import {
  assertValidPaymentInput,
  type Currency,
  type PaymentAdapter,
  type PaymentEvent,
  type PaymentSession,
  type PaymentSessionInput,
  type WebhookParseResult,
} from "../index.js";

export interface StripeAdapterConfig {
  secretKey: string;
  webhookSecret: string;
  /** Stripe API base（默认 https://api.stripe.com/v1）。 */
  apiBase?: string;
  /** 自定义 fetch（测试可注入）。 */
  fetchImpl?: typeof fetch;
}

export class StripeAdapter implements PaymentAdapter {
  readonly channel = "stripe" as const;
  private readonly cfg: Required<StripeAdapterConfig>;

  constructor(cfg: StripeAdapterConfig) {
    if (!cfg.secretKey?.startsWith("sk_")) {
      throw new Error("Stripe secretKey 必须以 sk_ 开头");
    }
    if (!cfg.webhookSecret?.startsWith("whsec_")) {
      throw new Error("Stripe webhookSecret 必须以 whsec_ 开头");
    }
    this.cfg = {
      apiBase: "https://api.stripe.com/v1",
      fetchImpl: globalThis.fetch,
      ...cfg,
    };
  }

  async createSession(input: PaymentSessionInput): Promise<PaymentSession> {
    assertValidPaymentInput(input);
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", input.returnUrl);
    if (input.cancelUrl) params.set("cancel_url", input.cancelUrl);
    params.set("client_reference_id", input.orderNo);
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
    params.set("line_items[0][price_data][unit_amount]", String(input.amountMinor));
    params.set("line_items[0][price_data][product_data][name]", `OpenBuddy ${input.planId}`);
    params.set("metadata[orderNo]", input.orderNo);
    params.set("metadata[planId]", input.planId);
    params.set("metadata[tenantId]", input.tenantId);
    params.set("metadata[subject]", input.subject);
    if (input.walletId) params.set("metadata[walletId]", input.walletId);
    for (const [k, v] of Object.entries(input.metadata ?? {})) {
      params.set(`metadata[${k}]`, v);
    }

    const res = await this.cfg.fetchImpl(`${this.cfg.apiBase}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Stripe createSession 失败 ${res.status}: ${errText.slice(0, 200)}`);
    }
    const session = (await res.json()) as {
      id: string;
      url: string;
      expires_at?: number;
    };
    return {
      channelSessionId: session.id,
      redirectUrl: session.url,
      ...(session.expires_at ? { expiresAt: new Date(session.expires_at * 1000).toISOString() } : {}),
    };
  }

  async parseWebhook(rawBody: string, signature: string): Promise<WebhookParseResult> {
    // Stripe 签名格式：t=<timestamp>,v1=<hmac>
    const parts = Object.fromEntries(
      signature.split(",").map((p) => {
        const [k, v] = p.split("=", 2);
        return [k?.trim() ?? "", v?.trim() ?? ""];
      }),
    );
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) throw new Error("Stripe webhook 签名格式错误");
    const signedPayload = `${t}.${rawBody}`;
    const expected = await hmacSHA256(signedPayload, this.cfg.webhookSecret);
    if (!timingSafeEqual(expected, v1)) {
      throw new Error("Stripe webhook 签名验证失败");
    }
    const payload = JSON.parse(rawBody) as StripeEvent;
    return mapStripeEvent(payload);
  }

  async queryOrder(channelOrderId: string): Promise<{ status: "pending" | "paid" | "failed" | "refunded" }> {
    const res = await this.cfg.fetchImpl(`${this.cfg.apiBase}/checkout/sessions/${channelOrderId}`, {
      headers: { Authorization: `Bearer ${this.cfg.secretKey}` },
    });
    if (!res.ok) throw new Error(`Stripe queryOrder 失败 ${res.status}`);
    const session = (await res.json()) as { payment_status: string; status: string };
    if (session.payment_status === "paid") return { status: "paid" };
    if (session.status === "expired") return { status: "failed" };
    return { status: "pending" };
  }

  async refund(channelPaymentId: string, amountMinor: number): Promise<{ refundId: string }> {
    const params = new URLSearchParams();
    params.set("payment_intent", channelPaymentId);
    params.set("amount", String(amountMinor));
    const res = await this.cfg.fetchImpl(`${this.cfg.apiBase}/refunds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) throw new Error(`Stripe refund 失败 ${res.status}`);
    const refund = (await res.json()) as { id: string };
    return { refundId: refund.id };
  }
}

interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

function mapStripeEvent(event: StripeEvent): WebhookParseResult {
  const obj = event.data.object;
  const orderNo = (obj.metadata as { orderNo?: string } | undefined)?.orderNo ?? (obj.client_reference_id as string | undefined);
  if (!orderNo) throw new Error("Stripe webhook 缺少 orderNo 元数据");

  const base = {
    channelEventId: event.id,
    orderNo,
    timestamp: event.created * 1000,
    raw: obj,
  };

  switch (event.type) {
    case "checkout.session.completed":
      return {
        event: {
          ...base,
          type: "payment.succeeded",
          amountMinor: typeof obj.amount_total === "number" ? obj.amount_total : undefined,
          currency: typeof obj.currency === "string" ? (obj.currency.toUpperCase() as Currency) : undefined,
          channelPaymentId: typeof obj.payment_intent === "string" ? obj.payment_intent : undefined,
        },
        dedupeKey: event.id,
      };
    case "checkout.session.expired":
      return {
        event: { ...base, type: "payment.expired" },
        dedupeKey: event.id,
      };
    case "charge.refunded":
      return {
        event: {
          ...base,
          type: "payment.refunded",
          amountMinor: typeof obj.amount_refunded === "number" ? obj.amount_refunded : undefined,
          channelPaymentId: typeof obj.payment_intent === "string" ? obj.payment_intent : (obj.id as string | undefined),
        },
        dedupeKey: event.id,
      };
    case "checkout.session.async_payment_failed":
    case "payment_intent.payment_failed":
      return {
        event: {
          ...base,
          type: "payment.failed",
          failureReason: (obj.failure_message as string | undefined) ?? "unknown",
        },
        dedupeKey: event.id,
      };
    default:
      throw new Error(`Stripe webhook 不支持的事件类型: ${event.type}`);
  }
}

async function hmacSHA256(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Factory for DI containers. */
export function createStripeAdapter(cfg: StripeAdapterConfig): PaymentAdapter {
  return new StripeAdapter(cfg);
}
