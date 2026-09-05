/**
 * @openbuddy/saml · SAML 2.0 SSO 适配器
 *
 * 适用场景：
 *   - 企业已有 SAML 2.0 IdP（Okta / Azure AD / OneLogin / Ping / 自建）
 *   - WorkBuddy / Code42 / 飞书 等产品的 SSO 集成
 *   - SCIM 自动配置 + SAML SSO 形成完整企业身份闭环
 *
 * 实现：纯函数 + 接口注入
 *   - buildAuthnRequest() → 构造 SAML AuthnRequest URL
 *   - parseSamlResponse() → 解析 base64 SAML Response（包含签名验证）
 *   - buildLogoutRequest() → SLO 单点登出
 *
 * 不实现（留给上层）：
 *   - XML 签名验证（XML-DSig，依赖 openssl / xml-crypto）
 *   - SP 元数据生成（需公钥/私钥对）
 *   - Artifact binding（仅支持 HTTP-POST/Redirect）
 *
 * 集成方式（OpenBuddy Desktop / Admin Portal）：
 *   1. Casdoor 后台启用 SAML Provider（Application → SAML）
 *   2. 上传企业 IdP metadata XML 到 Casdoor
 *   3. Casdoor 颁发签名证书 + Entity ID + ACS URL
 *   4. OpenBuddy 通过 Casdoor OIDC（已实现）间接使用 SAML
 */

export interface SamlConfig {
  /** SP entity ID（OpenBuddy 的 SAML 唯一标识）。 */
  spEntityId: string;
  /** IdP SSO 入口 URL（用户提供）。 */
  idpSsoUrl: string;
  /** 期望的 audience restriction（SP entity ID 或 ACS URL）。 */
  audience?: string;
  /** ACS URL（SAML Response POST 回调）。 */
  acsUrl: string;
  /** 签名算法（默认 rsa-sha256）。 */
  signAlgorithm?: "rsa-sha1" | "rsa-sha256";
  /** 签名证书（base64 DER，可选）。 */
  signingCert?: string;
}

export interface SamlAuthnRequest {
  /** 重定向 URL。 */
  redirectUrl: string;
  /** SAML Request ID（用于 Response 匹配）。 */
  id: string;
  /** IssueInstant（ISO）。 */
  issueInstant: string;
}

/**
 * 生成 SAML AuthnRequest XML（base64 编码后塞入 URL）。
 * 不含 XML 签名（OpenBuddy 是 SP，多数 IdP 允许 unsigned AuthnRequest）。
 */
export function buildAuthnRequest(cfg: SamlConfig, options: { forceAuthn?: boolean; nameIdFormat?: string } = {}): SamlAuthnRequest {
  const id = `_${randomId()}`;
  const issueInstant = new Date().toISOString();
  const forceAuthn = options.forceAuthn ? "true" : "false";
  const nameIdFormat = options.nameIdFormat ?? "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";

  const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${issueInstant}" Destination="${escapeXml(cfg.idpSsoUrl)}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" AssertionConsumerServiceURL="${escapeXml(cfg.acsUrl)}" ForceAuthn="${forceAuthn}"><saml:Issuer>${escapeXml(cfg.spEntityId)}</saml:Issuer><samlp:NameIDPolicy Format="${escapeXml(nameIdFormat)}" AllowCreate="true"/></samlp:AuthnRequest>`;

  const deflated = deflateRaw(xml);
  const encoded = base64UrlEncode(new Uint8Array(deflated));
  const url = new URL(cfg.idpSsoUrl);
  url.searchParams.set("SAMLRequest", encoded);
  if (cfg.audience) url.searchParams.set("RelayState", cfg.audience);

  return { redirectUrl: url.toString(), id, issueInstant };
}

export interface SamlAssertion {
  /** Subject NameID（通常是邮箱或 employeeID）。 */
  nameId: string;
  /** NameID Format。 */
  nameIdFormat: string;
  /** IssueInstant。 */
  issueInstant: string;
  /** NotOnOrAfter。 */
  notOnOrAfter: string;
  /** 属性语句。 */
  attributes: Record<string, string[]>;
  /** SessionIndex（用于 SLO）。 */
  sessionIndex?: string;
  /** Issuer（IdP entity ID）。 */
  issuer: string;
  /** Audience（必须匹配 SP entity ID 或 ACS URL）。 */
  audiences: string[];
}

export interface SamlParseResult {
  assertion: SamlAssertion;
  /** 原始 Response ID。 */
  responseId: string;
  /** 原始 InResponseTo（应等于 AuthnRequest ID）。 */
  inResponseTo?: string;
}

/**
 * 解析 SAML Response（base64）。
 *
 * 实现：DOM 解析 + 关键字段提取。不做 XML-DSig 验签（留给 Casdoor / 企业 IdP）。
 * 安全：调用方必须先校验证书链、Issuer、Audience、NotOnOrAfter。
 */
export function parseSamlResponse(cfg: SamlConfig, samlResponseBase64: string): SamlParseResult {
  const xml = new TextDecoder().decode(base64Decode(samlResponseBase64));
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error(`SAML Response XML 解析失败: ${parseError.textContent}`);

  const issuer = doc.querySelector("Issuer")?.textContent?.trim() ?? "";
  const responseId = doc.querySelector("Response")?.getAttribute("ID") ?? "";
  const inResponseTo = doc.querySelector("Response")?.getAttribute("InResponseTo") ?? undefined;

  const subject = doc.querySelector("Subject")?.querySelector("NameID");
  const nameId = subject?.textContent?.trim() ?? "";
  const nameIdFormat = subject?.getAttribute("Format") ?? "";

  const conditions = doc.querySelector("Conditions");
  const notOnOrAfter = conditions?.getAttribute("NotOnOrAfter") ?? "";
  const audienceNodes = Array.from(doc.querySelectorAll("AudienceRestriction > Audience"));
  const audiences = audienceNodes.map((n) => n.textContent?.trim() ?? "").filter(Boolean);

  const issueInstant = doc.querySelector("Assertion")?.getAttribute("IssueInstant") ?? "";
  const sessionIndex = doc.querySelector("AuthnStatement")?.getAttribute("SessionIndex") ?? undefined;

  // 提取属性
  const attributes: Record<string, string[]> = {};
  for (const attr of Array.from(doc.querySelectorAll("Attribute"))) {
    const name = attr.getAttribute("Name") ?? attr.getAttribute("FriendlyName") ?? "";
    if (!name) continue;
    const values = Array.from(attr.querySelectorAll("AttributeValue")).map((v) => v.textContent?.trim() ?? "");
    if (values.length > 0) attributes[name] = values;
  }

  // 校验 audience（如配置）
  if (cfg.audience && !audiences.includes(cfg.audience) && !audiences.includes(cfg.spEntityId) && !audiences.includes(cfg.acsUrl)) {
    throw new Error(`SAML audience mismatch: expected ${cfg.audience}, got [${audiences.join(", ")}]`);
  }

  // 校验 notOnOrAfter
  if (notOnOrAfter) {
    const expiry = new Date(notOnOrAfter);
    if (expiry.getTime() <= Date.now()) {
      throw new Error(`SAML assertion 已过期: notOnOrAfter=${notOnOrAfter}`);
    }
  }

  return {
    assertion: {
      nameId,
      nameIdFormat,
      issueInstant,
      notOnOrAfter,
      attributes,
      ...(sessionIndex ? { sessionIndex } : {}),
      issuer,
      audiences,
    },
    responseId,
    ...(inResponseTo ? { inResponseTo } : {}),
  };
}

/** 构造 SAML LogoutRequest URL（用于 SLO 单点登出）。 */
export function buildLogoutRequest(cfg: SamlConfig, options: { nameId: string; sessionIndex?: string }): string {
  const id = `_${randomId()}`;
  const issueInstant = new Date().toISOString();
  const xml = `<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${issueInstant}"><saml:Issuer>${escapeXml(cfg.spEntityId)}</saml:Issuer><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${escapeXml(options.nameId)}</saml:NameID>${options.sessionIndex ? `<samlp:SessionIndex>${escapeXml(options.sessionIndex)}</samlp:SessionIndex>` : ""}</samlp:LogoutRequest>`;
  const deflated = deflateRaw(xml);
  const encoded = base64UrlEncode(new Uint8Array(deflated));
  const url = new URL(cfg.idpSsoUrl);
  url.searchParams.set("SAMLRequest", encoded);
  return url.toString();
}

// ----------------- helpers -----------------

function randomId(): string {
  // RFC 4122 v4 UUID without dashes (16 hex bytes hex-encoded)
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64Decode(s: string): Uint8Array {
  let normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * 轻量级 DEFLATE 压缩（HTTP-Redirect binding 要求）。
 * Node 环境用 zlib；浏览器环境用 CompressionStream API。
 */
function deflateRaw(input: string): Uint8Array {
  // 同步 Node API（服务端使用 OK）
  // 注意：浏览器环境需要用 CompressionStream('deflate-raw') async
  if (typeof process !== "undefined" && process.versions?.node) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { deflateRawSync } = require("node:zlib");
    return deflateRawSync(Buffer.from(input, "utf8"));
  }
  throw new Error("SAML HTTP-Redirect binding 在浏览器环境需使用 async CompressionStream");
}
