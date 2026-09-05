import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function logoutToken(secret: string, claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }): string {
  const h = base64Url(JSON.stringify(header));
  const p = base64Url(JSON.stringify(claims));
  const sig = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${base64Url(sig)}`;
}

describe("Casdoor Resource Gateway backchannel logout", () => {
  const issuer = "http://casdoor.test";
  const audience = "openbuddy";
  const secret = "test-backchannel-secret";
  const event = { "http://schemas.openid.net/event/backchannel-logout": {} };
  let dataDir: string;
  let server: typeof import("./index.js").server;
  let endpoint: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(`${tmpdir()}/openbuddy-gateway-backchannel-`);
    process.env.NODE_ENV = "development";
    process.env.CASDOOR_ISSUER = issuer;
    process.env.CASDOOR_AUDIENCE = audience;
    process.env.RESOURCE_GATEWAY_DATA_DIR = dataDir;
    process.env.RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET = secret;
    ({ server } = await import("./index.js"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("gateway did not bind");
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (!server?.listening) { resolve(); return; }
      server.close(() => resolve());
    });
    await rm(dataDir, { recursive: true, force: true });
  });

  it("accepts a signed OIDC backchannel logout_token and records a member revocation", async () => {
    const tenant = "acme";
    const sub = `${tenant}/alice`;
    const now = Math.floor(Date.now() / 1000);
    const token = logoutToken(secret, { iss: issuer, aud: audience, sub, iat: now, exp: now + 60, jti: "logout-1", events: event });
    const response = await fetch(`${endpoint}/v1/backchannel-logout/casdoor`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `logout_token=${encodeURIComponent(token)}`,
    });
    expect(response.status).toBe(200);
    const json = await response.json() as { ok: boolean; subject: string; revokedAt: string };
    expect(json.ok).toBe(true);
    expect(json.subject).toBe(sub);
    expect(json.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects logout_token with bad signature", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = logoutToken("wrong-secret", { iss: issuer, aud: audience, sub: "acme/bob", iat: now, exp: now + 60, jti: "x", events: event });
    const response = await fetch(`${endpoint}/v1/backchannel-logout/casdoor`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `logout_token=${encodeURIComponent(token)}`,
    });
    expect(response.status).toBe(401);
    const json = await response.json() as { code: string };
    expect(json.code).toBe("BACKCHANNEL_SIGNATURE_INVALID");
  });

  it("rejects logout_token with wrong issuer", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = logoutToken(secret, { iss: "https://attacker.test", aud: audience, sub: "acme/carol", iat: now, exp: now + 60, jti: "x", events: event });
    const response = await fetch(`${endpoint}/v1/backchannel-logout/casdoor`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `logout_token=${encodeURIComponent(token)}`,
    });
    expect(response.status).toBe(401);
    const json = await response.json() as { code: string };
    expect(json.code).toBe("BACKCHANNEL_ISSUER_MISMATCH");
  });

  it("rejects logout_token with wrong audience", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = logoutToken(secret, { iss: issuer, aud: "other-client", sub: "acme/dan", iat: now, exp: now + 60, jti: "x", events: event });
    const response = await fetch(`${endpoint}/v1/backchannel-logout/casdoor`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `logout_token=${encodeURIComponent(token)}`,
    });
    expect(response.status).toBe(401);
    const json = await response.json() as { code: string };
    expect(json.code).toBe("BACKCHANNEL_AUDIENCE_MISMATCH");
  });

  it("rejects logout_token missing the backchannel-logout event", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = logoutToken(secret, { iss: issuer, aud: audience, sub: "acme/eve", iat: now, exp: now + 60, jti: "x", events: { "http://schemas.openid.net/event/other": {} } });
    const response = await fetch(`${endpoint}/v1/backchannel-logout/casdoor`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `logout_token=${encodeURIComponent(token)}`,
    });
    expect(response.status).toBe(400);
    const json = await response.json() as { code: string };
    expect(json.code).toBe("BACKCHANNEL_EVENT_MISSING");
  });

  it("rejects logout_token that is expired", async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = logoutToken(secret, { iss: issuer, aud: audience, sub: "acme/frank", iat: past, exp: past + 60, jti: "x", events: event });
    const response = await fetch(`${endpoint}/v1/backchannel-logout/casdoor`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `logout_token=${encodeURIComponent(token)}`,
    });
    expect(response.status).toBe(401);
    const json = await response.json() as { code: string };
    expect(json.code).toBe("BACKCHANNEL_TOKEN_EXPIRED");
  });

  it("rejects unsupported content-type", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = logoutToken(secret, { iss: issuer, aud: audience, sub: "acme/g", iat: now, exp: now + 60, jti: "x", events: event });
    const response = await fetch(`${endpoint}/v1/backchannel-logout/casdoor`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ logout_token: token }),
    });
    expect(response.status).toBe(415);
    const json = await response.json() as { code: string };
    expect(json.code).toBe("BACKCHANNEL_CONTENT_TYPE");
  });

  it("rejects GET method", async () => {
    const response = await fetch(`${endpoint}/v1/backchannel-logout/casdoor`, { method: "GET" });
    expect(response.status).toBe(405);
  });
});
