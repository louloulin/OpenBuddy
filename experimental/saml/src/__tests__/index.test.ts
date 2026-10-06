import { describe, expect, it } from "vitest";

import { inflateRawSync } from "node:zlib";

function decodeBase64Url(s: string): string {
  let normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  const compressed = Uint8Array.from(atob(normalized), (c) => c.charCodeAt(0));
  const inflated = inflateRawSync(compressed);
  return new TextDecoder().decode(inflated);
}


import { buildAuthnRequest, buildLogoutRequest, parseSamlResponse } from "../index";

const baseConfig = {
  spEntityId: "https://openbuddy.example.com/saml",
  idpSsoUrl: "https://idp.example.com/sso",
  acsUrl: "https://openbuddy.example.com/saml/acs",
  audience: "https://openbuddy.example.com/saml",
};

describe("buildAuthnRequest", () => {
  it("builds a valid AuthnRequest URL", () => {
    const req = buildAuthnRequest(baseConfig);
    expect(req.id).toMatch(/^_[0-9a-f]{32}$/);
    expect(req.issueInstant).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(req.redirectUrl).toMatch(/^https:\/\/idp\.example\.com\/sso\?SAMLRequest=/);
  });

  it("encodes issuer in XML", () => {
    const req = buildAuthnRequest(baseConfig);
    const params = new URL(req.redirectUrl).searchParams;
    const samlRequest = params.get("SAMLRequest")!;
    // 解码后查看 XML 是否包含 issuer
    const decoded = decodeBase64Url(samlRequest);
    expect(decoded).toContain("Issuer");
    expect(decoded).toContain(baseConfig.spEntityId);
  });

  it("supports forceAuthn", () => {
    const req = buildAuthnRequest(baseConfig, { forceAuthn: true });
    const params = new URL(req.redirectUrl).searchParams;
    const decoded = decodeBase64Url(params.get("SAMLRequest")!);
    expect(decoded).toContain('ForceAuthn="true"');
  });
});

describe("parseSamlResponse", () => {
  function buildSamlResponse(opts: {
    nameId?: string;
    audiences?: string[];
    notOnOrAfter?: string;
    inResponseTo?: string;
    attributes?: Record<string, string[]>;
    sessionIndex?: string;
  } = {}): string {
    const {
      nameId = "alice@example.com",
      audiences = [baseConfig.audience!],
      notOnOrAfter = new Date(Date.now() + 60_000).toISOString(),
      inResponseTo = "_authn_request_1",
      attributes = { email: ["alice@example.com"], role: ["admin", "user"] },
      sessionIndex = "_session_1",
    } = opts;
    const audienceXml = audiences.map((a) => `<saml:Audience>${a}</saml:Audience>`).join("");
    const attrsXml = Object.entries(attributes)
      .map(([k, vs]) => `<saml:Attribute Name="${k}">${vs.map((v) => `<saml:AttributeValue>${v}</saml:AttributeValue>`).join("")}</saml:Attribute>`)
      .join("");
    const xml = `<?xml version="1.0"?><samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_response_1" Version="2.0" IssueInstant="2026-01-01T00:00:00Z" Destination="${baseConfig.acsUrl}" InResponseTo="${inResponseTo}"><saml:Issuer>https://idp.example.com</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_assertion_1" Version="2.0" IssueInstant="2026-01-01T00:00:00Z"><saml:Issuer>https://idp.example.com</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${nameId}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${baseConfig.acsUrl}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="2026-01-01T00:00:00Z" NotOnOrAfter="${notOnOrAfter}"><saml:AudienceRestriction>${audienceXml}</saml:AudienceRestriction></saml:Conditions><saml:AttributeStatement>${attrsXml}</saml:AttributeStatement><saml:AuthnStatement AuthnInstant="2026-01-01T00:00:00Z" SessionIndex="${sessionIndex}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion></samlp:Response>`;
    return Buffer.from(xml, "utf8").toString("base64");
  }

  it("extracts NameID, Issuer, audiences, attributes", () => {
    const b64 = buildSamlResponse();
    const result = parseSamlResponse(baseConfig, b64);
    expect(result.assertion.nameId).toBe("alice@example.com");
    expect(result.assertion.issuer).toBe("https://idp.example.com");
    expect(result.assertion.audiences).toContain(baseConfig.audience!);
    expect(result.assertion.attributes.email).toEqual(["alice@example.com"]);
    expect(result.assertion.attributes.role).toEqual(["admin", "user"]);
    expect(result.assertion.sessionIndex).toBe("_session_1");
    expect(result.inResponseTo).toBe("_authn_request_1");
    expect(result.responseId).toBe("_response_1");
  });

  it("rejects audience mismatch", () => {
    const b64 = buildSamlResponse({ audiences: ["https://wrong.example.com"] });
    expect(() => parseSamlResponse(baseConfig, b64)).toThrow(/audience mismatch/);
  });

  it("rejects expired assertion", () => {
    const b64 = buildSamlResponse({ notOnOrAfter: new Date(Date.now() - 60_000).toISOString() });
    expect(() => parseSamlResponse(baseConfig, b64)).toThrow(/已过期/);
  });

  it("rejects malformed XML", () => {
    const b64 = Buffer.from("<not><valid></xml>", "utf8").toString("base64");
    expect(() => parseSamlResponse(baseConfig, b64)).toThrow(/XML 解析失败/);
  });

  it("accepts SP entity ID as audience fallback", () => {
    const b64 = buildSamlResponse({ audiences: [baseConfig.spEntityId] });
    const result = parseSamlResponse(baseConfig, b64);
    expect(result.assertion.audiences).toContain(baseConfig.spEntityId);
  });

  it("accepts ACS URL as audience fallback", () => {
    const b64 = buildSamlResponse({ audiences: [baseConfig.acsUrl] });
    const result = parseSamlResponse(baseConfig, b64);
    expect(result.assertion.audiences).toContain(baseConfig.acsUrl);
  });
});

describe("buildLogoutRequest", () => {
  it("builds logout URL with NameID", () => {
    const url = buildLogoutRequest(baseConfig, { nameId: "alice@example.com", sessionIndex: "_s1" });
    expect(url).toContain("https://idp.example.com/sso?SAMLRequest=");
    const params = new URL(url).searchParams;
    const decoded = decodeBase64Url(params.get("SAMLRequest")!);
    expect(decoded).toContain("LogoutRequest");
    expect(decoded).toContain("alice@example.com");
    expect(decoded).toContain("_s1");
  });

  it("omits sessionIndex when not provided", () => {
    const url = buildLogoutRequest(baseConfig, { nameId: "bob@example.com" });
    const decoded = decodeBase64Url(new URL(url).searchParams.get("SAMLRequest")!);
    expect(decoded).toContain("bob@example.com");
    expect(decoded).not.toContain("SessionIndex");
  });
});
