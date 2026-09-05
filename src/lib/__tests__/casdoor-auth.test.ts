import { describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  decodeJwtPayload,
  generatePkce,
  generatePkceS256,
  isCasdoorCallbackUrl,
  parseAuthCallback,
  validateIdTokenClaims,
} from "@openbuddy/auth-casdoor";
import { hasCasdoorCapability, mergeCasdoorClaims, normalizeCasdoorClaims, restrictCasdoorClaimsFromUserinfo } from "@openbuddy/auth-casdoor";
import { authorizeCasdoorTenant, buildCasdoorTenantContext } from "@openbuddy/auth-casdoor";
import { casdoorCapabilityError, deriveCasdoorLoginCapabilities } from "@openbuddy/auth-casdoor";

describe("Casdoor OIDC helpers", () => {
  it("builds a provider-hinted PKCE authorization URL", () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: "https://casdoor.test/login/oauth/authorize",
      tokenEndpoint: "https://casdoor.test/token",
      clientId: "client",
      redirectUri: "casdoor://localhost/callback",
      providerHint: "Wechat",
      signinMethod: "Verification code",
    }, generatePkce("verifier"), "state", "nonce");
    const params = new URL(url).searchParams;
    expect(params.get("provider_hint")).toBe("Wechat");
    expect(params.get("signinMethod")).toBe("Verification code");
    expect(params.get("nonce")).toBe("nonce");
    expect(params.get("code_challenge_method")).toBe("plain");
  });

  it("builds a generic enterprise authorization URL without provider hints", () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: "https://casdoor.test/login/oauth/authorize",
      tokenEndpoint: "https://casdoor.test/token",
      clientId: "client",
      redirectUri: "casdoor://localhost/callback",
      scope: "openid profile email",
    }, generatePkce("verifier"), "state", "nonce");
    const params = new URL(url).searchParams;
    expect(params.get("provider_hint")).toBeNull();
    expect(params.get("signinMethod")).toBeNull();
    expect(params.get("scope")).toBe("openid profile email");
  });

  it("generates S256 PKCE challenges for the Electron flow", async () => {
    const pkce = await generatePkceS256("verifier");
    expect(pkce.codeChallengeMethod).toBe("S256");
    expect(pkce.codeChallenge).not.toBe(pkce.codeVerifier);
  });

  it("parses query and fragment callbacks without accepting malformed URLs", () => {
    expect(parseAuthCallback("casdoor://localhost/callback?code=abc&state=s")).toEqual({ code: "abc", state: "s" });
    expect(parseAuthCallback("casdoor://localhost/callback#code=abc&state=s")).toEqual({ code: "abc", state: "s" });
    expect(parseAuthCallback("not a url")).toEqual({});
  });

  it("accepts only the exact Casdoor callback origin and path", () => {
    expect(isCasdoorCallbackUrl("casdoor://localhost/callback?code=a", "casdoor://localhost/callback")).toBe(true);
    expect(isCasdoorCallbackUrl("casdoor://localhost/callback/extra?code=a", "casdoor://localhost/callback")).toBe(false);
    expect(isCasdoorCallbackUrl("casdoor://attacker/callback?code=a", "casdoor://localhost/callback")).toBe(false);
  });

  it("validates issuer, audience, nonce, and time claims", () => {
    const valid = validateIdTokenClaims({ iss: "https://casdoor.test", aud: "client", nonce: "n", iat: 100, exp: 200 }, {
      issuer: "https://casdoor.test", clientId: "client", nonce: "n", nowSeconds: 150, clockSkewSeconds: 0,
    });
    expect(valid).toEqual({ ok: true });
    expect(validateIdTokenClaims({ iss: "wrong", aud: "client", exp: 200 }, { issuer: "https://casdoor.test", clientId: "client", nowSeconds: 150 })).toMatchObject({ ok: false, reason: "issuer_mismatch" });
    expect(validateIdTokenClaims({ iss: "https://casdoor.test", aud: ["client", "other"], exp: 200 }, { issuer: "https://casdoor.test", clientId: "client", nowSeconds: 150 })).toMatchObject({ ok: false, reason: "authorized_party_mismatch" });
    expect(validateIdTokenClaims({ iss: "https://casdoor.test", aud: ["client", "other"], azp: "client", exp: 200 }, { issuer: "https://casdoor.test", clientId: "client", nowSeconds: 150 })).toEqual({ ok: true });
  });

  it("decodes claims for subsequent main-process signature validation", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "u1", iss: "https://casdoor.test" })).toString("base64url");
    expect(decodeJwtPayload(`x.${payload}.y`)).toMatchObject({ sub: "u1" });
  });
});

describe("Casdoor permission normalization", () => {
  it("defaults to deny and maps explicit roles/permissions", () => {
    const identity = normalizeCasdoorClaims({ sub: "u1", owner: "org", roles: ["member"], permissions: ["team.workspace"] });
    expect(hasCasdoorCapability(identity, "team.workspace")).toBe(true);
    expect(hasCasdoorCapability(identity, "admin.portal")).toBe(false);
  });

  it("does not grant capabilities from substring lookalikes", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      permissions: ["not-team.workspace", "evil/admin.portal-extra"],
    });
    expect(identity.capabilities).toEqual([]);
  });

  it("grants the administrative capability set only to trusted admin roles", () => {
    const identity = normalizeCasdoorClaims({ sub: "admin", roles: ["admin"] });
    expect(identity.capabilities).toHaveLength(6);
    expect(identity.isAdmin).toBe(true);
  });

  it("retains all organizations while deriving the primary organization", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      owner: "built-in",
      organizations: ["built-in", "tenant/acme"],
    });
    expect(identity.owner).toBe("built-in");
    expect(identity.organization).toBe("built-in");
    expect(identity.organizations).toEqual(["built-in", "tenant/acme"]);
  });

  it("accepts organization claims in Casdoor slash-delimited form", () => {
    const identity = normalizeCasdoorClaims({ sub: "u1", organization: "tenant/acme,tenant/ops" });
    expect(identity.organizations).toEqual(["tenant/acme", "tenant/ops"]);
  });

  it("does not allow userinfo authorization claims to elevate a signed identity", () => {
    const merged = mergeCasdoorClaims(
      { sub: "u1", roles: ["member"], permissions: [] },
      { sub: "attacker", roles: ["admin"], permissions: ["admin.portal"], email: "u1@example.com" },
    );
    const identity = normalizeCasdoorClaims(merged);
    expect(identity.subject).toBe("u1");
    expect(identity.email).toBe("u1@example.com");
    expect(identity.isAdmin).toBe(false);
    expect(identity.capabilities).toEqual([]);
  });

  it("fails closed when userinfo marks a signed-in user as forbidden", () => {
    const merged = mergeCasdoorClaims(
      { sub: "u1", isForbidden: false, roles: ["member"] },
      { sub: "u1", isForbidden: true },
    );
    const identity = normalizeCasdoorClaims(merged);
    expect(identity.isForbidden).toBe(true);
    expect(identity.capabilities).toEqual([]);
  });

  it("keeps authenticated userinfo roles when the ID token omits optional role claims", () => {
    const identity = normalizeCasdoorClaims(mergeCasdoorClaims(
      { sub: "u1" },
      { sub: "u1", roles: ["member"], permissions: ["team.workspace"], groups: ["engineering"] },
    ));
    expect(identity.roles).toEqual(["member"]);
    expect(identity.permissions).toEqual(["team.workspace"]);
    expect(identity.groups).toEqual(["engineering"]);
    expect(identity.capabilities).toEqual(["team.workspace"]);
  });

  it("lets explicit UserInfo claims revoke trusted authorization on refresh", () => {
    const trusted = normalizeCasdoorClaims({
      sub: "u1",
      organizations: ["tenant-a"],
      permissions: [{ owner: "tenant-a", name: "team.workspace" }],
    });
    const claims = {
      sub: trusted.subject,
      organizations: trusted.organizations,
      roles: trusted.roles,
      permissions: trusted.permissions,
      groups: trusted.groups,
      capabilities: trusted.capabilities,
      isAdmin: trusted.isAdmin,
      isForbidden: trusted.isForbidden,
      isDeleted: trusted.isDeleted,
    };
    const refreshed = normalizeCasdoorClaims(mergeCasdoorClaims(claims, {
      sub: "attacker",
      organizations: ["tenant-b"],
      permissions: ["admin.portal"],
      email: "u1@example.com",
    }));
    expect(refreshed.subject).toBe("u1");
    expect(refreshed.organizations).toEqual([]);
    expect(refreshed.capabilities).toEqual([]);
    expect(refreshed.email).toBe("u1@example.com");
  });

  it("allows refresh userinfo to revoke signed roles without allowing it to elevate", () => {
    const restricted = restrictCasdoorClaimsFromUserinfo(
      { sub: "u1", organizations: ["tenant-a", "tenant-b"], roles: [{ owner: "tenant-a", name: "tenant-admin" }], permissions: [{ owner: "tenant-a", name: "team.workspace" }] },
      { sub: "u1", organizations: ["tenant-a"], roles: [{ owner: "tenant-a", name: "member" }], permissions: ["admin.portal"] },
    );
    const identity = normalizeCasdoorClaims(restricted);
    expect(identity.organizations).toEqual(["tenant-a"]);
    expect(identity.roles).toEqual([]);
    expect(identity.permissions).toEqual([]);
    expect(identity.isAdmin).toBe(false);
  });

  it("normalizes Casdoor object-shaped authorization claims", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      roles: [{ owner: "built-in", name: "member" }],
      permissions: [{ owner: "built-in", name: "team.workspace" }],
      groups: [{ owner: "built-in", name: "engineering" }],
    });
    expect(identity.roles).toEqual(["built-in/member"]);
    expect(identity.permissions).toEqual(["built-in/team.workspace"]);
    expect(identity.groups).toEqual(["built-in/engineering"]);
    expect(identity.capabilities).toEqual(["team.workspace"]);
    expect(identity.isAdmin).toBe(false);
  });

  it("recognizes a tenant-qualified administrative role without trusting display names", () => {
    const identity = normalizeCasdoorClaims({
      sub: "admin",
      roles: [{ owner: "built-in", name: "admin" }],
      displayName: "Administrator",
    });
    expect(identity.isAdmin).toBe(true);
    expect(identity.capabilities).toHaveLength(6);
  });

  it("does not grant disabled or explicitly denied Casdoor claims", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      roles: [{ owner: "built-in", name: "admin", isEnabled: false }],
      permissions: [
        { owner: "built-in", name: "team.workspace", effect: "Deny", isEnabled: true },
        { owner: "built-in", name: "cloud.sync", isEnabled: false },
      ],
    });
    expect(identity.isAdmin).toBe(false);
    expect(identity.capabilities).toEqual([]);
  });

  it("rejects forbidden users even when Casdoor returns administrative claims", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      isAdmin: true,
      isForbidden: true,
      roles: ["admin"],
      permissions: ["admin.portal", "team.workspace"],
    });
    expect(identity.isForbidden).toBe(true);
    expect(identity.isAdmin).toBe(false);
    expect(identity.capabilities).toEqual([]);
  });

  it("lets explicit Casdoor deny claims override administrative grants", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      isAdmin: true,
      roles: [{ owner: "built-in", name: "admin" }],
      permissions: [{ owner: "built-in", name: "admin.portal", effect: "Deny" }],
    });
    expect(identity.isAdmin).toBe(true);
    expect(identity.capabilities).not.toContain("admin.portal");
    expect(identity.capabilities).toHaveLength(5);
  });

  it("does not grant capabilities to deleted users", () => {
    const identity = normalizeCasdoorClaims({ sub: "u1", isDeleted: true, roles: ["admin"] });
    expect(identity.isDeleted).toBe(true);
    expect(identity.capabilities).toEqual([]);
  });

  it("keeps tenant roles and permissions isolated by Casdoor owner", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      organizations: ["tenant-a", "tenant-b"],
      roles: [
        { owner: "tenant-a", name: "tenant-admin" },
        { owner: "tenant-b", name: "member" },
      ],
      permissions: [
        { owner: "tenant-a", name: "tenant.users.write" },
        { owner: "tenant-b", name: "tenant.audit.read" },
      ],
    });
    expect(identity.tenantMemberships).toEqual([
      expect.objectContaining({ tenantId: "tenant-a", isTenantAdmin: true }),
      expect.objectContaining({ tenantId: "tenant-b", isTenantAdmin: false, tenantPermissions: ["tenant.audit.read"] }),
    ]);
    expect(authorizeCasdoorTenant(identity, "tenant-a", { permission: "tenant.users.write" }).allowed).toBe(true);
    expect(authorizeCasdoorTenant(identity, "tenant-b", { permission: "tenant.users.write" }).reason).toBe("permission_denied");
  });

  it("requires an explicit active tenant and rejects cross-tenant access", () => {
    const identity = normalizeCasdoorClaims({ sub: "u1", organizations: ["tenant-a", "tenant-b"], permissions: [{ owner: "tenant-a", name: "team.workspace" }] });
    expect(buildCasdoorTenantContext(identity, "tenant-b").membership).toBeDefined();
    expect(authorizeCasdoorTenant(identity, undefined, { capability: "team.workspace" }).reason).toBe("tenant_not_selected");
    expect(authorizeCasdoorTenant(identity, "tenant-b", { capability: "team.workspace" }).allowed).toBe(false);
  });

  it("returns stable machine-readable authorization codes", () => {
    const identity = normalizeCasdoorClaims({ sub: "user-a", organizations: ["tenant-a"], permissions: ["workspace.read"] });
    expect(authorizeCasdoorTenant(identity, undefined, { capability: "team.workspace" }).code).toBe("CASDOOR_TENANT_REQUIRED");
    expect(authorizeCasdoorTenant(identity, "tenant-a", { resource: "workspace", action: "write" }).code).toBe("CASDOOR_PERMISSION_DENIED");
    expect(authorizeCasdoorTenant(identity, "tenant-a", { resource: "workspace", action: "read" }).code).toBe("CASDOOR_AUTHORIZED");
  });

  it("supports resource/action decisions without trusting renderer tenant input", () => {
    const identity = normalizeCasdoorClaims({
      sub: "member",
      organizations: ["tenant-a"],
      permissions: ["workspace.read", "documents:*"],
    });
    expect(authorizeCasdoorTenant(identity, "tenant-a", { resource: "workspace", action: "read" }).allowed).toBe(true);
    expect(authorizeCasdoorTenant(identity, "tenant-a", { resource: "workspace", action: "write" }).allowed).toBe(false);
    expect(authorizeCasdoorTenant(identity, "tenant-a", { resource: "documents", action: "delete" }).allowed).toBe(true);
    expect(authorizeCasdoorTenant(identity, "tenant-b", { resource: "workspace", action: "read" }).reason).toBe("tenant_not_member");
  });

  it("auto-selects the only tenant but leaves multiple tenants unselected", () => {
    const singleTenant = normalizeCasdoorClaims({ sub: "u1", organizations: ["tenant-a"], permissions: [{ owner: "tenant-a", name: "team.workspace" }] });
    expect(buildCasdoorTenantContext(singleTenant).activeTenantId).toBe("tenant-a");

    const multipleTenants = normalizeCasdoorClaims({ sub: "u1", organizations: ["tenant-a", "tenant-b"] });
    expect(buildCasdoorTenantContext(multipleTenants).activeTenantId).toBeUndefined();
    expect(buildCasdoorTenantContext(multipleTenants, "tenant-b").activeTenantId).toBe("tenant-b");
  });

  it("maps a tenant-admin role to tenant management permissions only", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      organizations: ["tenant-a", "tenant-b"],
      roles: [{ owner: "tenant-a", name: "tenant-admin" }],
    });
    const tenantA = identity.tenantMemberships.find((membership) => membership.tenantId === "tenant-a");
    const tenantB = identity.tenantMemberships.find((membership) => membership.tenantId === "tenant-b");
    expect(tenantA?.tenantPermissions).toContain("tenant.users.write");
    expect(tenantB?.tenantPermissions).toEqual([]);
    expect(authorizeCasdoorTenant(identity, "tenant-a", { permission: "tenant.users.write" }).allowed).toBe(true);
    expect(authorizeCasdoorTenant(identity, "tenant-b", { permission: "tenant.users.write" }).allowed).toBe(false);
  });
});

describe("Casdoor admin overview gating", () => {
  it("provides management surfaces that default to deny without admin", () => {
    const identity = normalizeCasdoorClaims({ sub: "u1", roles: ["member"] });
    expect(hasCasdoorCapability(identity, "admin.portal")).toBe(false);
  });
  it("grants admin.portal only to trusted administrative roles", () => {
    const identity = normalizeCasdoorClaims({ sub: "admin", roles: ["owner"] });
    expect(hasCasdoorCapability(identity, "admin.portal")).toBe(true);
  });
});

describe("Casdoor provider capability detection", () => {
  it("denies SMS when the application flag is disabled even if the sign-in method is listed", () => {
    const result = deriveCasdoorLoginCapabilities({
      enableCodeSignin: false,
      signinMethods: [{ name: "Verification code", rule: "All" }],
    }, 123);
    expect(result.sms.enabled).toBe(false);
    expect(result.sms.reason).toContain("未启用 Verification code");
    expect(result.checkedAt).toBe(123);
  });

  it("requires a sign-in-capable WeChat OAuth provider and returns its Casdoor hint", () => {
    const result = deriveCasdoorLoginCapabilities({
      enableCodeSignin: true,
      signinMethods: [{ name: "Verification code", rule: "All" }],
      providers: [
        { name: "captcha", canSignIn: false, provider: { category: "Captcha", type: "Default" } },
        { name: "sms-prod", canSignIn: true, provider: { category: "SMS", type: "Tencent Cloud SMS", accessKey: "configured", accessKeySecret: "configured" } },
        { name: "wechat-prod", canSignIn: true, provider: { category: "OAuth", type: "WeChat" } },
      ],
      scopes: ["openid", "profile"],
    });
    expect(result.sms.enabled).toBe(true);
    expect(result.wechat.enabled).toBe(false);
    expect(result.wechat.reason).toContain("client ID");
    expect(result.status).toBe("available");
  });

  it("accepts WeChat only when the bound OAuth provider has credentials", () => {
    const result = deriveCasdoorLoginCapabilities({
      providers: [{ name: "binding-wechat", canSignIn: true, provider: { name: "provider_wechat_prod", category: "OAuth", type: "WeChat", clientId: "wx-app", clientSecret: "configured" } }],
    });
    expect(result.wechat).toMatchObject({ enabled: true, providerHint: "provider_wechat_prod" });
  });

  it("requires the exact desktop callback when a deployment supplies redirect URIs", () => {
    const result = deriveCasdoorLoginCapabilities({
      redirectUris: ["https://wrong.example/callback"],
    }, "casdoor://localhost/callback");
    expect(result.enterprise.enabled).toBe(false);
    expect(result.enterprise.reason).toContain("Redirect URIs");
  });

  it("diagnoses an explicitly empty OIDC scope configuration", () => {
    const result = deriveCasdoorLoginCapabilities({ scopes: [] });
    expect(result.enterprise.enabled).toBe(false);
    expect(result.enterprise.reason).toContain("openid");
    expect(result.status).toBe("misconfigured");
  });

  it("does not treat Mock SMS as an enterprise SMS gateway", () => {
    const result = deriveCasdoorLoginCapabilities({
      enableCodeSignin: true,
      signinMethods: [{ name: "Verification code", rule: "All" }],
      providers: [{ name: "mock", canSignIn: true, provider: { category: "SMS", type: "Mock SMS" } }],
    });
    expect(result.sms.enabled).toBe(false);
  });

  it("keeps provider failures explicit and default-deny", () => {
    const result = casdoorCapabilityError("network unavailable", 456);
    expect(result).toMatchObject({ status: "error", checkedAt: 456, error: "network unavailable" });
    expect(result.sms.enabled).toBe(false);
    expect(result.wechat.enabled).toBe(false);
  });

  it("requires SMS Provider with real gateway credentials and template fields", () => {
    const result = deriveCasdoorLoginCapabilities({
      enableCodeSignin: true,
      signinMethods: [{ name: "Verification code", rule: "All" }],
      providers: [{ name: "tencent-sms", canSignIn: true, provider: { category: "SMS", type: "Tencent Cloud SMS", accessKey: "AK", accessKeySecret: "SK", signName: "OpenBuddy", templateCode: "SMS-1" } }],
    });
    expect(result.sms.enabled).toBe(true);
    const blocked = deriveCasdoorLoginCapabilities({
      enableCodeSignin: true,
      signinMethods: [{ name: "Verification code", rule: "All" }],
      providers: [{ name: "tencent-sms", canSignIn: true, provider: { category: "SMS", type: "Tencent Cloud SMS" } }],
    });
    expect(blocked.sms.enabled).toBe(false);
    expect(blocked.sms.reason).toMatch(/绑定.*SMS Provider|短信网关/);
  });

  it("requires WeChat OAuth Provider with appId and appSecret", () => {
    const enabled = deriveCasdoorLoginCapabilities({
      providers: [{ name: "wechat", canSignIn: true, provider: { category: "OAuth", type: "WeChat", clientId: "wx-appid", clientSecret: "wx-secret" } }],
    });
    expect(enabled.wechat.enabled).toBe(true);
    const blocked = deriveCasdoorLoginCapabilities({
      providers: [{ name: "wechat", canSignIn: true, provider: { category: "OAuth", type: "WeChat" } }],
    });
    expect(blocked.wechat.enabled).toBe(false);
    expect(blocked.wechat.reason).toMatch(/WeChat|appid|微信/);
  });
});

describe("Casdoor tenant plan / pricing surfacing (C1)", () => {
  it("extracts per-tenant plan from a properties object keyed by tenant", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      organizations: ["tenant-a", "tenant-b"],
      properties: { "tenant-a": { plan: "team" }, "tenant-b": { plan: "enterprise" } },
    });
    expect(identity.tenantMemberships.find((m) => m.tenantId === "tenant-a")?.plan).toBe("team");
    expect(identity.tenantMemberships.find((m) => m.tenantId === "tenant-b")?.plan).toBe("enterprise");
  });

  it("falls back to a top-level plan claim for the primary tenant", () => {
    const identity = normalizeCasdoorClaims({ sub: "u1", organizations: ["tenant-a"], plan: "free" });
    expect(identity.tenantMemberships.find((m) => m.tenantId === "tenant-a")?.plan).toBe("free");
  });

  it("prefers per-tenant properties.plan over the top-level plan fallback", () => {
    const identity = normalizeCasdoorClaims({ sub: "u1", organizations: ["tenant-a"], plan: "free", properties: { "tenant-a": { plan: "team" } } });
    expect(identity.tenantMemberships.find((m) => m.tenantId === "tenant-a")?.plan).toBe("team");
  });

  it("surfaces the active tenant plan on the tenant context", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      organizations: ["tenant-a", "tenant-b"],
      properties: { "tenant-a": { plan: "team" }, "tenant-b": { plan: "enterprise" } },
    });
    const contextA = buildCasdoorTenantContext(identity, "tenant-a");
    const contextB = buildCasdoorTenantContext(identity, "tenant-b");
    expect(contextA.plan).toBe("team");
    expect(contextB.plan).toBe("enterprise");
    expect(contextA.plansByTenantId).toEqual({ "tenant-a": "team", "tenant-b": "enterprise" });
  });

  it("leaves plan undefined when Casdoor does not return any plan claims", () => {
    const identity = normalizeCasdoorClaims({ sub: "u1", organizations: ["tenant-a"] });
    const context = buildCasdoorTenantContext(identity);
    expect(context.plan).toBeUndefined();
    expect(context.plansByTenantId ?? {}).toEqual({});
  });

  it("ignores properties entries with non-string or empty plan values", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      organizations: ["tenant-a"],
      properties: { "tenant-a": { plan: "" }, "tenant-b": { plan: 42 } },
    });
    expect(identity.tenantMemberships.find((m) => m.tenantId === "tenant-a")?.plan).toBeUndefined();
    expect(identity.tenantMemberships.find((m) => m.tenantId === "tenant-b")?.plan).toBeUndefined();
  });
});

describe("Casdoor custom signup fields surfacing (C4)", () => {
  it("extracts string / number / boolean custom fields from claims.properties", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      organizations: ["tenant-a"],
      properties: { department: "Engineering", employeeId: 12345, remoteWorker: true, expired: "" },
    });
    expect(identity.customFields).toEqual({ department: "Engineering", employeeId: 12345, remoteWorker: true });
  });

  it("omits the customFields key entirely when no fields are present", () => {
    const identity = normalizeCasdoorClaims({ sub: "u1", organizations: ["tenant-a"] });
    expect(identity.customFields).toBeUndefined();
  });

  it("ignores null / array / NaN / Infinity values in properties", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      organizations: ["tenant-a"],
      properties: { bad1: null, bad2: [1, 2, 3], bad3: Number.NaN, bad4: Number.POSITIVE_INFINITY, ok: "value" },
    });
    expect(identity.customFields).toEqual({ ok: "value" });
  });

  it("coexists with the C1 plan extraction without conflict", () => {
    const identity = normalizeCasdoorClaims({
      sub: "u1",
      organizations: ["tenant-a"],
      plan: "team",
      properties: { department: "Sales" },
    });
    expect(identity.tenantMemberships.find((m) => m.tenantId === "tenant-a")?.plan).toBe("team");
    expect(identity.customFields).toEqual({ department: "Sales" });
  });
});
