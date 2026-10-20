/**
 * WeChat Pay（微信支付）V3 适配器
 *
 * 适用场景：中国境内企业客户的微信支付、公众号支付、Native 扫码支付。
 * 凭据要求：
 *   - WECHAT_PAY_APP_ID（wx...）
 *   - WECHAT_PAY_MCH_ID（商户号）
 *   - WECHAT_PAY_API_V3_KEY（API v3 密钥，32字节）
 *   - WECHAT_PAY_CERT_SERIAL（API 证书序列号）
 *   - WECHAT_PAY_PRIVATE_KEY（PEM 格式，RSA）
 *   - WECHAT_PAY_NOTIFY_URL（回调地址）
 *
 * 协议：WeChat Pay API v3（HMAC-SHA256 with RSA + AES-256-GCM 回调加密）
 * 参考：https://pay.weixin.qq.com/wiki/doc/apiv3/
 *
 * 实现要点：
 *   - createSession → POST /v3/pay/transactions/native（生成二维码 URL）
 *   - parseWebhook → 解密 AEAD_AES_256_GCM，回调验签
 *   - 签名：WECHATPAY2-SHA256-RSA2048 头
 */

import {
  assertValidPaymentInput,
  type PaymentAdapter,
  type PaymentEvent,
  type PaymentSession,
  type PaymentSessionInput,
  type WebhookParseResult,
} from "../index.js";

export interface WechatPayConfig {
  appId: string;
  mchId: string;
  apiV3Key: string;
  certSerial: string;
  privateKey: string;
  notifyUrl: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export class WechatPayAdapter implements PaymentAdapter {
  readonly channel = "wechat-pay" as const;
  private readonly cfg: Required<WechatPayConfig>;

  constructor(cfg: WechatPayConfig) {
    if (!cfg.appId?.startsWith("wx")) throw new Error("WeChat appId 必须以 wx 开头");
    if (!cfg.mchId) throw new Error("WeChat mchId 不能为空");
    if (cfg.apiV3Key.length !== 32) throw new Error("WeChat API v3 key 必须是 32 字节");
    if (!cfg.privateKey.includes("BEGIN PRIVATE KEY") && !cfg.privateKey.includes("BEGIN RSA PRIVATE KEY")) {
      throw new Error("WeChat privateKey 必须是 PEM 格式");
    }
    this.cfg = {
      apiBase: "https://api.mch.weixin.qq.com",
      fetchImpl: globalThis.fetch,
      ...cfg,
    };
  }

  async createSession(input: PaymentSessionInput): Promise<PaymentSession> {
    assertValidPaymentInput(input);
    if (input.currency !== "CNY") {
      throw new Error("WeChat Pay 仅支持 CNY");
    }
    const url = "/v3/pay/transactions/native";
    const body = JSON.stringify({
      appid: this.cfg.appId,
      mchid: this.cfg.mchId,
      description: `OpenBuddy ${input.planId}`,
      out_trade_no: input.orderNo,
      // 微信金额单位：分
      amount: { total: input.amountMinor, currency: input.currency },
      notify_url: this.cfg.notifyUrl,
      attach: input.walletId ? `wallet:${input.walletId}` : `tenant:${input.tenantId}`,
    });
    const authHeader = await this.sign("POST", url, body);
    const res = await this.cfg.fetchImpl(`${this.cfg.apiBase}${url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authHeader,
        "User-Agent": "openbuddy-payment/0.1",
      },
      body,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`WeChat createSession 失败 ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = (await res.json()) as { code_url: string };
    return {
      channelSessionId: input.orderNo,
      redirectUrl: data.code_url, // Native 扫码 URL
      qrCode: data.code_url,
    };
  }

  async parseWebhook(rawBody: string, signature: string): Promise<WebhookParseResult> {
    // 微信 v3 webhook：
    // Header: Wechatpay-Timestamp, Wechatpay-Nonce, Wechatpay-Signature, Wechatpay-Serial
    // 验签：message = timestamp + "\n" + nonce + "\n" + body + "\n"
    // 签名格式：WECHATPAY2-SHA256-RSA2048 sha256=...
    // 本实现仅校验签名格式；具体 timestamp/nonce 由调用方提供 header
    const headers = parseWechatSignatureHeader(signature);
    if (!headers.signature) throw new Error("WeChat webhook 签名格式错误");
    const message = `${headers.timestamp}\n${headers.nonce}\n${rawBody}\n`;
    const expected = await rsaSHA256(message, this.cfg.privateKey);
    if (!timingSafeEqual(expected, headers.signature)) {
      throw new Error("WeChat webhook 签名验证失败");
    }
    // 解密 resource.ciphertext（AES-256-GCM）
    const payload = JSON.parse(rawBody) as {
      id: string;
      create_time: string;
      event_type: string;
      resource: { ciphertext: string; associated_data: string; nonce: string };
    };
    const plaintext = await aesGcmDecrypt(
      payload.resource.ciphertext,
      payload.resource.associated_data,
      payload.resource.nonce,
      this.cfg.apiV3Key,
    );
    const data = JSON.parse(plaintext) as {
      out_trade_no: string;
      transaction_id: string;
      amount: { total: number };
      result_code?: string;
    };
    return {
      event: {
        channelEventId: payload.id,
        type: "payment.succeeded",
        orderNo: data.out_trade_no,
        channelPaymentId: data.transaction_id,
        amountMinor: data.amount.total,
        currency: "CNY",
        timestamp: new Date(payload.create_time).getTime(),
        raw: data,
      },
      dedupeKey: payload.id,
    };
  }

  async refund(channelPaymentId: string, amountMinor: number): Promise<{ refundId: string }> {
    const url = `/v3/refund/domestic/refunds`;
    const body = JSON.stringify({
      transaction_id: channelPaymentId,
      out_refund_no: `rf_${Date.now()}`,
      amount: { refund: amountMinor, total: amountMinor, currency: "CNY" },
    });
    const authHeader = await this.sign("POST", url, body);
    const res = await this.cfg.fetchImpl(`${this.cfg.apiBase}${url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body,
    });
    if (!res.ok) throw new Error(`WeChat refund 失败 ${res.status}`);
    const data = (await res.json()) as { refund_id: string };
    return { refundId: data.refund_id };
  }

  /** 生成 WECHATPAY2-SHA256-RSA2048 头。 */
  private async sign(method: string, urlPath: string, body: string): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = Math.random().toString(36).slice(2, 18);
    const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = await rsaSHA256(message, this.cfg.privateKey);
    return `WECHATPAY2-SHA256-RSA2048 mchid="${this.cfg.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${this.cfg.certSerial}",signature="${signature}"`;
  }
}

function parseWechatSignatureHeader(header: string): { timestamp: string; nonce: string; signature: string } {
  const out = { timestamp: "", nonce: "", signature: "" };
  const re = /(\w+)="?([^,"]+)"?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(header)) !== null) {
    const [, k, v] = match;
    if (k === "timestamp") out.timestamp = v;
    if (k === "nonce_str") out.nonce = v;
    if (k === "signature") out.signature = v;
  }
  return out;
}

async function rsaSHA256(message: string, privateKeyPem: string): Promise<string> {
  // node:crypto 是 Node 环境；浏览器环境用 SubtleCrypto.importKey + sign
  const enc = new TextEncoder();
  if (typeof process !== "undefined" && process.versions?.node) {
    const { createSign } = await import("node:crypto");
    const signer = createSign("RSA-SHA256");
    signer.update(message);
    signer.end();
    return signer.sign(privateKeyPem, "base64");
  }
  // 浏览器回退：导入 PEM private key（需要 PKCS8 转 DER）
  const pemBody = privateKeyPem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function aesGcmDecrypt(ciphertext: string, associatedData: string, nonce: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(key);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const ciphertextBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Uint8Array.from(atob(nonce), (c) => c.charCodeAt(0)), additionalData: enc.encode(associatedData) },
    cryptoKey,
    ciphertextBytes,
  );
  return new TextDecoder().decode(plaintext);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Factory. */
export function createWechatPayAdapter(cfg: WechatPayConfig): PaymentAdapter {
  return new WechatPayAdapter(cfg);
}
