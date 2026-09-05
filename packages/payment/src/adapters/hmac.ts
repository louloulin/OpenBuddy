/**
 * HMAC 通用支付通道适配器
 *
 * 适用场景：
 *   1. 自建测试 / Mock 通道
 *   2. 银行直连（对公转账）
 *   3. 加密货币 / 内部积分通道
 *   4. 任何需要 HMAC-SHA256 webhook 签名验证的自定义通道
 *
 * 协议：简单 JSON + HMAC-SHA256
 *   - 请求：任意 JSON
 *   - webhook：Header X-OpenBuddy-Signature: sha256=<hex>
 *              签名原文：`${timestamp}.${rawBody}`
 *
 * 凭据：
 *   - HMAC_SECRET（≥ 32 字节随机）
 */

import {
  assertValidPaymentInput,
  type PaymentAdapter,
  type PaymentEvent,
  type PaymentSession,
  type PaymentSessionInput,
  type WebhookParseResult,
} from "../index.js";

export interface HmacGenericConfig {
  secret: string;
  /** 可选 webhook 时间戳容差（毫秒，默认 300000 = 5 分钟）。 */
  timestampToleranceMs?: number;
  /** 可选签名头名称（默认 X-OpenBuddy-Signature）。 */
  signatureHeader?: string;
  /** 当前时间（测试可注入）。 */
  now?: () => number;
}

export class HmacGenericAdapter implements PaymentAdapter {
  readonly channel = "hmac-generic" as const;
  private readonly cfg: Required<HmacGenericConfig>;

  constructor(cfg: HmacGenericConfig) {
    if (cfg.secret.length < 32) {
      throw new Error("HMAC secret 必须至少 32 字符");
    }
    this.cfg = {
      timestampToleranceMs: 300_000,
      signatureHeader: "X-OpenBuddy-Signature",
      now: () => Date.now(),
      ...cfg,
    };
  }

  async createSession(input: PaymentSessionInput): Promise<PaymentSession> {
    assertValidPaymentInput(input);
    // 不与任何真实通道对接；返回 orderNo 作为 sessionId + 一个本地占位 URL
    return {
      channelSessionId: input.orderNo,
      redirectUrl: `https://pay.example.com/local/${input.orderNo}`,
    };
  }

  async parseWebhook(rawBody: string, signatureHeader: string): Promise<WebhookParseResult> {
    const timestamp = this.extractTimestamp(signatureHeader);
    const signature = this.extractSignature(signatureHeader);
    if (!signature) throw new Error("HMAC webhook 缺少签名");

    if (timestamp !== undefined) {
      const skew = Math.abs(this.cfg.now() - timestamp);
      if (skew > this.cfg.timestampToleranceMs) {
        throw new Error(`HMAC webhook 时间戳漂移过大: ${skew}ms`);
      }
    }

    const message = timestamp !== undefined ? `${timestamp}.${rawBody}` : rawBody;
    const expected = await hmacSHA256Hex(message, this.cfg.secret);
    if (!timingSafeEqual(expected, signature)) {
      throw new Error("HMAC webhook 签名验证失败");
    }
    const payload = JSON.parse(rawBody) as {
      id?: string;
      type?: PaymentEvent["type"] | string;
      orderNo?: string;
      timestamp?: number;
      [k: string]: unknown;
    };
    if (!payload.orderNo) throw new Error("HMAC webhook 缺少 orderNo");
    return {
      event: {
        channelEventId: payload.id ?? `${payload.orderNo}-${payload.timestamp ?? Date.now()}`,
        type: (payload.type as PaymentEvent["type"]) ?? "payment.succeeded",
        orderNo: payload.orderNo,
        timestamp: payload.timestamp ?? this.cfg.now(),
        raw: payload,
      },
      dedupeKey: payload.id ?? `${payload.orderNo}-${payload.type ?? "unknown"}`,
    };
  }

  private extractTimestamp(header: string): number | undefined {
    const m = header.match(/t=(\d+)/);
    return m ? Number(m[1]) : undefined;
  }

  private extractSignature(header: string): string | null {
    const m = header.match(/(?:^|,)sha256=([0-9a-f]{64})/i);
    return m ? m[1]!.toLowerCase() : null;
  }
}

async function hmacSHA256Hex(message: string, secret: string): Promise<string> {
  if (typeof process !== "undefined" && process.versions?.node) {
    const { createHmac } = await import("node:crypto");
    return createHmac("sha256", secret).update(message).digest("hex");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
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

/** Factory. */
export function createHmacGenericAdapter(cfg: HmacGenericConfig): PaymentAdapter {
  return new HmacGenericAdapter(cfg);
}
