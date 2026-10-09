/**
 * Alipay（支付宝）适配器
 *
 * 适用场景：中国境内企业客户的支付宝支付。
 * 凭据要求：
 *   - ALIPAY_APP_ID
 *   - ALIPAY_PRIVATE_KEY（PEM，应用私钥）
 *   - ALIPAY_PUBLIC_KEY（PEM，支付宝公钥）
 *   - ALIPAY_NOTIFY_URL
 *
 * 协议：Alipay OpenAPI（OpenAPI 3.0 + RSA2 签名）
 * 参考：https://opendocs.alipay.com/
 */

import {
  assertValidPaymentInput,
  type PaymentAdapter,
  type PaymentSession,
  type PaymentSessionInput,
  type WebhookParseResult,
} from "../index.js";

export interface AlipayConfig {
  appId: string;
  privateKey: string;
  publicKey: string;
  notifyUrl: string;
  /** API gateway，默认 https://openapi.alipay.com/gateway.do。 */
  apiBase?: string;
  /** 是否沙箱。 */
  sandbox?: boolean;
  fetchImpl?: typeof fetch;
}

export class AlipayAdapter implements PaymentAdapter {
  readonly channel = "alipay" as const;
  private readonly cfg: Required<AlipayConfig>;

  constructor(cfg: AlipayConfig) {
    if (!cfg.appId) throw new Error("Alipay appId 不能为空");
    if (!cfg.privateKey.includes("PRIVATE KEY")) throw new Error("Alipay privateKey 必须为 PEM");
    if (!cfg.publicKey.includes("PUBLIC KEY")) throw new Error("Alipay publicKey 必须为 PEM");
    this.cfg = {
      apiBase: "https://openapi.alipay.com/gateway.do",
      sandbox: false,
      fetchImpl: globalThis.fetch,
      ...cfg,
    };
  }

  async createSession(input: PaymentSessionInput): Promise<PaymentSession> {
    assertValidPaymentInput(input);
    if (input.currency !== "CNY") throw new Error("Alipay 仅支持 CNY");
    const params: Record<string, string> = {
      app_id: this.cfg.appId,
      method: "alipay.trade.precreate",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "+08:00"),
      version: "1.0",
      biz_content: JSON.stringify({
        out_trade_no: input.orderNo,
        total_amount: (input.amountMinor / 100).toFixed(2),
        subject: `OpenBuddy ${input.planId}`,
        notify_url: this.cfg.notifyUrl,
      }),
    };
    params.sign = await this.signParams(params);
    const search = new URLSearchParams(params).toString();
    const url = `${this.cfg.apiBase}?${search}`;
    const res = await this.cfg.fetchImpl(url, { method: "GET" });
    if (!res.ok) throw new Error(`Alipay createSession 失败 ${res.status}`);
    const data = (await res.json()) as { alipay_trade_precreate_response: { qr_code?: string; code: string; msg: string } };
    const r = data.alipay_trade_precreate_response;
    if (r.code !== "10000" || !r.qr_code) {
      throw new Error(`Alipay 业务错误 ${r.code}: ${r.msg}`);
    }
    return {
      channelSessionId: input.orderNo,
      redirectUrl: r.qr_code,
      qrCode: r.qr_code,
    };
  }

  async parseWebhook(rawBody: string, signature: string): Promise<WebhookParseResult> {
    // Alipay 异步通知：application/x-www-form-urlencoded 形式，sign 字段在末尾
    const params = Object.fromEntries(new URLSearchParams(rawBody));
    const sign = params.sign;
    if (!sign) throw new Error("Alipay webhook 缺少 sign");
    if (!await this.verifySign(params, sign)) {
      throw new Error("Alipay webhook 签名验证失败");
    }
    return {
      event: {
        channelEventId: params.notify_id ?? params.out_trade_no ?? `alipay-${Date.now()}`,
        type: params.trade_status === "TRADE_SUCCESS" || params.trade_status === "TRADE_FINISHED" ? "payment.succeeded" : "payment.failed",
        orderNo: params.out_trade_no,
        channelPaymentId: params.trade_no,
        amountMinor: Math.round(parseFloat(params.total_amount ?? "0") * 100),
        currency: "CNY",
        timestamp: Date.parse(params.notify_time ?? new Date().toISOString()),
        failureReason: params.trade_status === "TRADE_CLOSED" ? "trade_closed" : undefined,
        raw: params,
      },
      dedupeKey: params.notify_id ?? params.out_trade_no ?? `${params.trade_no}-${params.gmt_payment}`,
    };
  }

  private async signParams(params: Record<string, string>): Promise<string> {
    const keys = Object.keys(params).filter((k) => k !== "sign").sort();
    const stringToSign = keys.map((k) => `${k}=${params[k]}`).join("&");
    return rsa2Sign(stringToSign, this.cfg.privateKey);
  }

  private async verifySign(params: Record<string, string>, sign: string): Promise<boolean> {
    const keys = Object.keys(params).filter((k) => k !== "sign" && k !== "sign_type").sort();
    const stringToSign = keys.map((k) => `${k}=${params[k]}`).join("&");
    return rsa2Verify(stringToSign, sign, this.cfg.publicKey);
  }
}

async function rsa2Sign(message: string, privateKeyPem: string): Promise<string> {
  if (typeof process !== "undefined" && process.versions?.node) {
    const { createSign } = await import("node:crypto");
    const signer = createSign("RSA-SHA256");
    signer.update(message, "utf8");
    signer.end();
    return signer.sign(privateKeyPem, "base64");
  }
  throw new Error("Alipay 签名在浏览器环境未实现，请使用 Node 服务端");
}

async function rsa2Verify(message: string, signature: string, publicKeyPem: string): Promise<boolean> {
  if (typeof process !== "undefined" && process.versions?.node) {
    const { createVerify } = await import("node:crypto");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(message, "utf8");
    verifier.end();
    return verifier.verify(publicKeyPem, signature, "base64");
  }
  return false;
}

/** Factory. */
export function createAlipayAdapter(cfg: AlipayConfig): PaymentAdapter {
  return new AlipayAdapter(cfg);
}
