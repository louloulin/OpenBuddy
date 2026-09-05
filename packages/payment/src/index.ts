/**
 * @openbuddy/payment · 支付通道适配器
 *
 * 目标：把 OpenBuddy Resource Gateway 的 HMAC 支付回调契约
 *      适配到具体支付通道（Stripe / WeChat Pay / Alipay）。
 *
 * 设计原则：
 * 1. **平台无关核心**：所有通道共用 `PaymentAdapter` 接口与 `PaymentEvent` 类型
 * 2. **服务端注入凭据**：Secret 永不出 Renderer / 桌面端 / Portal
 * 3. **幂等 + 重放保护**：每个通道都自带 `idempotencyKey`
 * 4. **同步 + 异步双模式**：同步立即返回 redirectUrl；异步通过 webhook 通知结果
 *
 * 使用示例（Resource Gateway）：
 * ```ts
 * import { StripeAdapter } from "@openbuddy/payment/stripe";
 * const stripe = new StripeAdapter({
 *   secretKey: process.env.STRIPE_SECRET_KEY!,
 *   webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
 * });
 *
 * // 创建支付会话
 * const session = await stripe.createSession({
 *   orderNo: "ord_001",
 *   amountMinor: 9900,
 *   currency: "CNY",
 *   planId: "team",
 *   tenantId: "casdoor/enterprise",
 *   subject: "alice",
 *   returnUrl: "https://openbuddy.com/billing/return",
 * });
 * console.log(session.redirectUrl);
 *
 * // 解析 webhook
 * const event = stripe.parseWebhook(rawBody, signature);
 * ```
 */

export type PaymentChannel = "stripe" | "wechat-pay" | "alipay" | "hmac-generic";

export type Currency = "CNY" | "USD" | "EUR" | "JPY" | "HKD";

export type PaymentEventType = "payment.succeeded" | "payment.failed" | "payment.expired" | "payment.refunded";

export interface PaymentSessionInput {
  /** OpenBuddy 内部订单号（幂等键）。 */
  orderNo: string;
  /** 金额最小单位（分）。 */
  amountMinor: number;
  /** ISO 4217 货币。 */
  currency: Currency;
  /** OpenBuddy SKU ID（如 free / team / enterprise）。 */
  planId: string;
  /** Casdoor tenantId。 */
  tenantId: string;
  /** Casdoor subject（购买人）。 */
  subject: string;
  /** 共享钱包 ID（可选）。 */
  walletId?: string;
  /** 用户支付完成后的跳转地址。 */
  returnUrl: string;
  /** 取消支付时的跳转地址。 */
  cancelUrl?: string;
  /** 通道元数据（如 Stripe 的 customer_email）。 */
  metadata?: Record<string, string>;
}

export interface PaymentSession {
  /** 通道侧的 session/checkout ID。 */
  channelSessionId: string;
  /** 用户跳转到通道完成支付的 URL。 */
  redirectUrl: string;
  /** 通道侧二维码（仅 WeChat Pay）。 */
  qrCode?: string;
  /** 该 session 过期时间（ISO）。 */
  expiresAt?: string;
}

export interface PaymentEvent {
  /** 通道原始事件 ID。 */
  channelEventId: string;
  /** 事件类型。 */
  type: PaymentEventType;
  /** OpenBuddy 订单号。 */
  orderNo: string;
  /** 通道侧 payment id。 */
  channelPaymentId?: string;
  /** 实际扣款金额（分）。 */
  amountMinor?: number;
  currency?: Currency;
  /** 失败原因（仅 type=failed）。 */
  failureReason?: string;
  /** webhook 时间戳（毫秒）。 */
  timestamp: number;
  /** 原始 payload（用于审计）。 */
  raw: Record<string, unknown>;
}

export interface WebhookParseResult {
  event: PaymentEvent;
  /** 通道侧事件 ID，用于去重。 */
  dedupeKey: string;
}

/**
 * 通用支付通道适配器接口。
 *
 * Resource Gateway 通过此接口接入任意支付通道，
 * 不需要修改 Gateway 主代码。
 */
export interface PaymentAdapter {
  /** 通道 ID（与 PaymentChannel 联合类型一一对应）。 */
  readonly channel: PaymentChannel;

  /** 创建支付会话。 */
  createSession(input: PaymentSessionInput): Promise<PaymentSession>;

  /**
   * 解析通道 webhook 回调。
   * 实现必须：
   *   1. 验证 HMAC/RSA 签名
   *   2. 把通道 payload 映射为统一 PaymentEvent
   *   3. 返回 dedupeKey 用于幂等
   */
  parseWebhook(rawBody: string, signature: string): Promise<WebhookParseResult>;

  /** 查询订单状态（可选）。 */
  queryOrder?(channelOrderId: string): Promise<{ status: "pending" | "paid" | "failed" | "refunded" }>;

  /** 发起退款（可选）。 */
  refund?(channelPaymentId: string, amountMinor: number): Promise<{ refundId: string }>;
}

/**
 * 安全断言：金额合法 + 货币合法 + 订单号合法。
 */
export function assertValidPaymentInput(input: PaymentSessionInput): void {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1) {
    throw new Error(`Payment amount 必须为正整数（分），收到 ${input.amountMinor}`);
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new Error(`Currency 必须是 ISO 4217 三字母代码，收到 ${input.currency}`);
  }
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(input.orderNo)) {
    throw new Error(`OrderNo 非法: ${input.orderNo}`);
  }
  if (!input.planId.trim()) throw new Error("planId 不能为空");
  if (!input.tenantId.trim()) throw new Error("tenantId 不能为空");
  if (!input.subject.trim()) throw new Error("subject 不能为空");
  if (!/^https?:\/\//.test(input.returnUrl)) throw new Error("returnUrl 必须是 http(s) URL");
}

export { StripeAdapter, createStripeAdapter } from "./adapters/stripe.js";
export { WechatPayAdapter, createWechatPayAdapter } from "./adapters/wechat-pay.js";
export { AlipayAdapter, createAlipayAdapter } from "./adapters/alipay.js";
export { HmacGenericAdapter, createHmacGenericAdapter } from "./adapters/hmac.js";
