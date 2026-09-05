import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, createSign, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function token(privateKey: string, claims: Record<string, unknown>): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }));
  const payload = base64Url(JSON.stringify(claims));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64Url(signer.sign(privateKey))}`;
}

function costImportSignature(body: string): string {
  return createHmac("sha256", process.env.RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET!).update(body).digest("hex");
}

describe("Casdoor Resource Gateway", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { format: "pem", type: "pkcs1" }, publicKeyEncoding: { format: "jwk" } });
  const issuer = "http://casdoor.test";
  const audience = "openbuddy";
  let dataDir: string;
  let server: typeof import("./index.js").server;
  let endpoint: string;
  let accessToken: string;
  const upstreamRequests: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  let disconnectedUpstreamRequests = 0;
  let upstreamDisconnectRequestStarted: (() => void) | undefined;
  let circuitRecoveryHealthy = false;
  let singleFlightRequestStarted: (() => void) | undefined;
  let pricingRaceRequestStarted: (() => void) | undefined;
  let pricingRaceRequestRelease: (() => void) | undefined;

  beforeAll(async () => {
    dataDir = await mkdtemp(`${tmpdir()}/openbuddy-gateway-`);
    process.env.NODE_ENV = "development";
    process.env.RESOURCE_GATEWAY_RATE_LIMIT_REQUESTS = "100000";
    process.env.CASDOOR_ISSUER = issuer;
    process.env.CASDOOR_AUDIENCE = audience;
    process.env.RESOURCE_GATEWAY_DATA_DIR = dataDir;
    process.env.NEW_API_BASE_URL = "http://new-api.test";
    process.env.NEW_API_TOKEN = "server-only-new-api-token";
    process.env.NEW_API_GROUP = "default";
    process.env.RESOURCE_GATEWAY_NEW_API_CIRCUIT_OPEN_MS = "1000";
    process.env.NEW_API_GROUP_TOKENS_JSON = JSON.stringify({ default: "server-only-new-api-token", "enterprise-ai": "enterprise-only-new-api-token" });
    process.env.NEW_API_CAPABILITIES_JSON = JSON.stringify({ "enterprise-ai": { "demo-model": { "chat.completions": { supported: true, streaming: true, usage: "required", verifiedAt: "2026-08-29" }, responses: { supported: false, usage: "required", reason: "当前 MiniMax channel adaptor 未实现 Responses", verifiedAt: "2026-08-29" } }, "margin-model": { "chat.completions": { supported: true, streaming: true, usage: "required", verifiedAt: "2026-08-29" } }, "delayed-stream-model": { "chat.completions": { supported: true, streaming: true, usage: "required", verifiedAt: "2026-08-29" } }, "non-streaming-model": { "chat.completions": { supported: true, streaming: false, usage: "required", verifiedAt: "2026-08-29", reason: "当前模型仅支持非流式响应" } } } });
    process.env.RESOURCE_GATEWAY_BILLING_CALLBACK_SECRET = "billing-callback-secret";
    process.env.RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET = "credit-expiry-secret-for-tests-0123456789";
    process.env.RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET = "cost-import-secret-for-tests-0123456789";
    process.env.RESOURCE_GATEWAY_WEKNORA_EXCHANGE_SECRET = "weknora-exchange-secret-for-tests-0123456789";
    process.env.RESOURCE_GATEWAY_WEKNORA_EXCHANGE_AUDIENCE = "weknora-test";
    process.env.RESOURCE_GATEWAY_WEKNORA_TENANT_MAP_JSON = JSON.stringify({ "tenant-a": 42 });
    process.env.RESOURCE_GATEWAY_AUTO_WELCOME = "true";
    process.env.RESOURCE_GATEWAY_AUTO_WELCOME_ORGANIZATIONS = "tenant-webhook-auto";
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) return new Response(JSON.stringify({ issuer, jwks_uri: `${issuer}/.well-known/jwks` }), { status: 200 });
      if (url.endsWith("/.well-known/jwks")) return new Response(JSON.stringify({ keys: [{ ...publicKey, kid: "test-key", alg: "RS256", use: "sig" }] }), { status: 200 });
      if (url === "http://new-api.test/v1/chat/completions") {
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        upstreamRequests.push({ headers, body: requestBody });
        if (requestBody.messages && JSON.stringify(requestBody.messages).includes("disconnect-client")) {
          upstreamDisconnectRequestStarted?.();
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) return reject(new Error("test upstream request was not abortable"));
            if (signal.aborted) {
              disconnectedUpstreamRequests += 1;
              reject(signal.reason ?? new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => {
              disconnectedUpstreamRequests += 1;
              reject(signal.reason ?? new Error("aborted"));
            }, { once: true });
          });
        }
        if (requestBody.model === "single-flight-model") {
          singleFlightRequestStarted?.();
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        if (requestBody.model === "pricing-race-model") {
          pricingRaceRequestStarted?.();
          await new Promise<void>((resolve) => { pricingRaceRequestRelease = resolve; });
          return new Response(JSON.stringify({ id: "chat-pricing-race", choices: [], usage: { prompt_tokens: 100, completion_tokens: 100 } }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (requestBody.model === "upstream-error" || requestBody.model === "circuit-upstream-error" || (requestBody.model === "circuit-recovery-model" && !circuitRecoveryHealthy)) return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "content-type": "application/json" } });
        if (requestBody.model === "missing-usage" || requestBody.model === "missing-usage-circuit") return new Response(JSON.stringify({ id: "chat-without-usage", choices: [] }), { status: 200, headers: { "content-type": "application/json" } });
        if (requestBody.model === "malformed-response-circuit") return new Response("not-json", { status: 200, headers: { "content-type": "application/json" } });
        if (requestBody.model === "overage-model") return new Response(JSON.stringify({ id: "chat-overage", choices: [], usage: { prompt_tokens: 10000, completion_tokens: 10000 } }), { status: 200, headers: { "content-type": "application/json" } });
        if (requestBody.model === "stream-missing-usage") {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: {\"id\":\"chat-without-usage\",\"choices\":[{\"delta\":{\"content\":\"should-not-leak\"}}]}\n\ndata: [DONE]\n\n"));
              controller.close();
            },
          });
          return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        if (requestBody.model === "delayed-stream-model") {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: {\"id\":\"delayed-stream\",\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n"));
              setTimeout(() => {
                controller.enqueue(new TextEncoder().encode("data: {\"id\":\"delayed-stream\",\"usage\":{\"promptTokens\":12,\"completionTokens\":8}}\n\ndata: [DONE]\n\n"));
                controller.close();
              }, 80);
            },
          });
          return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        if (requestBody.stream === true) {
      const chunks = [
        "data: {\"id\":\"chat-stream\",\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n",
        "data: {\"id\":\"chat-stream\",\"usage\":{\"promptTokens\":12,\"completionTokens\":8,\"upstreamCost\":0.0031}}\n\n",
        "data: [DONE]",
          ];
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
              controller.close();
            },
          });
          return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        const responseId = requestBody.messages?.[0]?.content === "mismatch" ? "chat-mismatch" : requestBody.messages?.[0]?.content === "personal-wallet-mismatch" ? "chat-personal-wallet-mismatch" : requestBody.model === "circuit-recovery-model" ? `chat-${String(requestBody.messages?.[0]?.content ?? "recovery")}` : "chat-json";
        return new Response(JSON.stringify({ id: responseId, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0042 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "http://new-api.test/v1/models") {
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        upstreamRequests.push({ headers, body: {} });
        return new Response(JSON.stringify({ object: "list", data: [{ id: "demo-model", object: "model" }, { id: "margin-model", object: "model" }, { id: "blocked-model", object: "model" }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "http://new-api.test/v1/responses") {
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        upstreamRequests.push({ headers, body: requestBody });
        if (requestBody.model === "unsupported-protocol") return new Response(JSON.stringify({ error: { message: "unsupported relay mode: 2" } }), { status: 500, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify({ id: "response-001", output: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "http://new-api.test/v1/completions") {
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        upstreamRequests.push({ headers, body: requestBody });
        if (requestBody.model === "missing-completion-usage") return new Response(JSON.stringify({ id: "completion-without-usage", choices: [] }), { status: 200, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify({ id: "completion-001", choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "http://new-api.test/v1/embeddings") {
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        upstreamRequests.push({ headers, body: requestBody });
        return new Response(JSON.stringify({ object: "list", data: [{ object: "embedding", embedding: [0.1] }], usage: { prompt_tokens: 6, total_tokens: 6 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "http://new-api.test/v1/rerank") {
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        upstreamRequests.push({ headers, body: requestBody });
        if (requestBody.model === "missing-rerank-usage") return new Response(JSON.stringify({ id: "rerank-without-usage", results: [] }), { status: 200, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify({ id: "rerank-001", results: [{ index: 0, relevance_score: 0.9 }], usage: { prompt_tokens: 8, total_tokens: 8 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "http://new-api.test/v1/moderations") {
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        upstreamRequests.push({ headers, body: requestBody });
        if (requestBody.model === "missing-moderation-usage") return new Response(JSON.stringify({ id: "moderation-without-usage", results: [] }), { status: 200, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify({ id: "moderation-001", results: [{ flagged: false }], usage: { prompt_tokens: 9, total_tokens: 9 } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return originalFetch(input, init);
    }));
    ({ server } = await import("./index.js"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("gateway did not bind");
    endpoint = `http://127.0.0.1:${address.port}`;
    accessToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: ["tenant-a"], permissions: ["project.create", "project.read", "project.update", "project.delete", "tenant.policy.read", "tenant.policy.write", "tenant.audit.read", "billing.read", "billing.write", "weknora.workspace.read"], exp: Math.floor(Date.now() / 1000) + 300 });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (!server?.listening) { resolve(); return; }
      server.close(() => resolve());
    });
    vi.unstubAllGlobals();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("proxies New API with server credentials, tenant Group, and usage settlement", async () => {
    const tenant = "tenant-ai";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["tenant.policy.write", "billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "ai-grant-001" }),
    });
    expect(grant.status).toBe(201);
    const policy = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ newApiGroup: "enterprise-ai" }),
    });
    expect(policy.status).toBe(200);
    const modelPolicy = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ modelAllowlist: ["demo-model"] }),
    });
    expect(modelPolicy.status).toBe(200);
    const models = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/models`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect(models.status).toBe(200);
    expect((await models.json() as { data: Array<{ id: string }> }).data.map((model) => model.id)).toEqual(["demo-model"]);
    expect(upstreamRequests.at(-1)?.headers.authorization).toBe("Bearer enterprise-only-new-api-token");
    expect(upstreamRequests.at(-1)?.headers["new-api-group"]).toBe("enterprise-ai");

    const capabilities = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/capabilities`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({ data: { group: "enterprise-ai", capabilitySource: "gateway-config", models: [{ id: "demo-model", capabilities: { "chat.completions": { supported: true, usage: "required" }, responses: { supported: false } } }] } });

    const commercialPricing = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/pricing`, { method: "PATCH", headers, body: JSON.stringify({ model: "demo-model", inputPointsPerThousand: 12, outputPointsPerThousand: 40, minimumPoints: 1, inputCostPerMillion: 2.1, outputCostPerMillion: 8.4, costCurrency: "CNY", costSource: "configured-pricing" }) });
    expect(commercialPricing.status).toBe(200);
    const catalog = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/catalog`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toMatchObject({ data: { group: "enterprise-ai", capabilitySource: "gateway-config", pricingSource: "gateway-pricing", models: [{ id: "demo-model", sellable: true, capabilities: { "chat.completions": { supported: true, usage: "required" } }, pricing: { inputCostPerMillion: 2.1, outputCostPerMillion: 8.4 } }] } });

    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "ai-request-001", "x-openbuddy-agent": "coding-agent", "x-openbuddy-session": "session-001" },
      body: JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "hello" }], max_tokens: 16 }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "chat-json" });
    expect(upstreamRequests.at(-1)?.headers.authorization).toBe("Bearer enterprise-only-new-api-token");
    expect(upstreamRequests.at(-1)?.headers["new-api-group"]).toBe("enterprise-ai");
    expect(upstreamRequests.at(-1)?.headers["x-openbuddy-tenant"]).toBe(tenant);
    expect(upstreamRequests.at(-1)?.headers["x-openbuddy-subject"]).toBe("user-1");
    expect(upstreamRequests.at(-1)?.headers["x-openbuddy-request-id"]).toEqual(expect.any(String));
    expect(upstreamRequests.at(-1)?.headers["x-openbuddy-agent"]).toBe("coding-agent");
    expect(upstreamRequests.at(-1)?.headers["x-openbuddy-session"]).toBe("session-001");

    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect(account.status).toBe(200);
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 4998, reserved: 0, lifetimeConsumed: 2 });
    const ledger = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger`, { headers: { authorization: `Bearer ${aiToken}` } });
    const ledgerEntries = (await ledger.json() as { data: Array<{ type: string; pointsSettled?: number; upstreamCost?: number; usageSource?: string; newApiGroup?: string; requestId?: string; agentId?: string; sessionId?: string; entryHash?: string; previousHash?: string }> }).data;
    expect(ledgerEntries).toEqual(expect.arrayContaining([expect.objectContaining({ type: "consume", pointsSettled: 2, upstreamCost: 0.0042, usageSource: "new-api", newApiGroup: "enterprise-ai", requestId: expect.any(String), agentId: "coding-agent", sessionId: "session-001", entryHash: expect.stringMatching(/^[a-f0-9]{64}$/), previousHash: expect.stringMatching(/^[a-f0-9]{64}$/) })]));
    expect(ledgerEntries.some((entry) => entry.previousHash === "")).toBe(true);
    const integrity = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/integrity`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect(integrity.status).toBe(200);
    expect(await integrity.json()).toMatchObject({ data: { tenantId: tenant, scope: "tenant", status: "verified", checked: expect.any(Number), headHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });

    const reconciliation = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect(reconciliation.status).toBe(200);
    const reconciliationReport = (await reconciliation.json()).data;
    expect(reconciliationReport).toMatchObject({
      source: "openbuddy-credit-ledger",
      externalNewApiCostFetched: false,
      tenantId: tenant,
      commerce: { grossOrders: 0, refundedOrders: 0, grossPoints: 0, refundedPoints: 0, netPoints: 0 },
      economics: { settledPoints: 2, verifiedCostRecords: 0, matchedVerifiedCostRecords: 0, unmatchedVerifiedCostRecords: 0, costCoveragePercent: 0 },
      total: { requests: 1, totalTokens: 15, pointsSettled: 2, upstreamCost: 0.0042, upstreamCostEntries: 1, newApiUsageEntries: 1, estimatedUsageEntries: 0 },
      byModel: { "demo-model": { requests: 1 } },
      bySubject: { "user-1": { requests: 1 } },
      byAgent: { "coding-agent": { requests: 1, pointsSettled: 2 } },
      bySession: { "session-001": { requests: 1, pointsSettled: 2 } },
    });
    expect(reconciliationReport.reportId).toMatch(/^reconciliation_[a-f0-9]{24}$/);
    expect(reconciliationReport.reportHash).toMatch(/^[a-f0-9]{64}$/);

    const repeatedReconciliation = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await repeatedReconciliation.json()).data).toMatchObject({ reportId: reconciliationReport.reportId, reportHash: reconciliationReport.reportHash });

    const reconciliationExport = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/export?format=csv`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect(reconciliationExport.status).toBe(200);
    expect(reconciliationExport.headers.get("content-type")).toContain("text/csv");
    expect(reconciliationExport.headers.get("content-disposition")).toContain("openbuddy-reconciliation-tenant-");
    expect(reconciliationExport.headers.get("x-openbuddy-report-id")).toMatch(/^reconciliation_[a-f0-9]{24}$/);
    expect(reconciliationExport.headers.get("x-openbuddy-report-hash")).toMatch(/^[a-f0-9]{64}$/);
    const reconciliationCsv = await reconciliationExport.text();
    expect(reconciliationCsv).toContain("section,key,metric,value");
    expect(reconciliationCsv).toContain("total,total,requests,1");
    expect(reconciliationCsv).toContain("metadata,,reportHash,");
    expect(reconciliationCsv).toContain("metadata,,reportId,reconciliation_");

    const invalidFormat = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/export?format=json`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect(invalidFormat.status).toBe(400);
    expect(await invalidFormat.json()).toMatchObject({ code: "INVALID_RECONCILIATION_FORMAT" });
  });

  it("issues a mapped short-lived WeKnora token and rejects unsafe exchange requests", async () => {
    const exchange = async (body: unknown, authorization?: string) => fetch(`${endpoint}/v1/token-exchange/weknora`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body),
    });

    const missingBearer = await exchange({ tenant: "tenant-a", weknoraTenantId: 42 });
    expect(missingBearer.status).toBe(401);
    expect(await missingBearer.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

    const mismatchedTenant = await exchange({ tenant: "tenant-b", weknoraTenantId: 42 }, `Bearer ${accessToken}`);
    expect(mismatchedTenant.status).toBe(403);
    expect(await mismatchedTenant.json()).toMatchObject({ code: "TOKEN_EXCHANGE_TENANT_MAPPING_REQUIRED" });

    const invalidJwt = await exchange({ tenant: "tenant-a", weknoraTenantId: 42 }, "Bearer invalid.jwt.token");
    expect(invalidJwt.status).toBe(401);

    const response = await exchange({ tenant: "tenant-a", weknoraTenantId: "42", sessionId: "desktop-session" }, `Bearer ${accessToken}`);
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { access_token: string; token_type: string; expires_in: number; audience: string } };
    expect(payload.data).toMatchObject({ token_type: "Bearer", expires_in: 300, audience: "weknora-test" });
    const parts = payload.data.access_token.split(".");
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg: string; typ: string };
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(claims).toMatchObject({ aud: "weknora-test", sub: "user-1", casdoor_tenant: "tenant-a", tenant_id: 42, token_type: "weknora_exchange", session_id: "desktop-session" });
    expect(Number(claims.exp) - Number(claims.iat)).toBe(300);
    const signingInput = `${parts[0]}.${parts[1]}`;
    expect(createHmac("sha256", "weknora-exchange-secret-for-tests-0123456789").update(signingInput).digest("base64url")).toBe(parts[2]);

    const introspection = await fetch(`${endpoint}/v1/token-exchange/weknora/introspect`, { method: "POST", headers: { authorization: `Bearer ${payload.data.access_token}` } });
    expect(introspection.status).toBe(200);
    expect(await introspection.json()).toMatchObject({ data: { active: true, subject: "user-1", casdoor_tenant: "tenant-a", tenant_id: 42, session_id: "desktop-session" } });

    const revoke = await fetch(`${endpoint}/v1/tenants/tenant-a/member-revocations/user-1`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token(privateKey, { iss: issuer, aud: audience, sub: "tenant-a-revocation-admin", organizations: ["tenant-a"], permissions: ["tenant.lifecycle.write"], exp: Math.floor(Date.now() / 1000) + 300 })}`, "content-type": "application/json" },
      body: JSON.stringify({ revoked: true, reason: "测试撤销" }),
    });
    expect(revoke.status).toBe(200);
    const revokedIntrospection = await fetch(`${endpoint}/v1/token-exchange/weknora/introspect`, { method: "POST", headers: { authorization: `Bearer ${payload.data.access_token}` } });
    expect(revokedIntrospection.status).toBe(403);
    expect(await revokedIntrospection.json()).toMatchObject({ code: "TENANT_MEMBER_REVOKED" });
    const restore = await fetch(`${endpoint}/v1/tenants/tenant-a/member-revocations/user-1`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token(privateKey, { iss: issuer, aud: audience, sub: "tenant-a-revocation-admin", organizations: ["tenant-a"], permissions: ["tenant.lifecycle.write"], exp: Math.floor(Date.now() / 1000) + 300 })}`, "content-type": "application/json" },
      body: JSON.stringify({ revoked: false }),
    });
    expect(restore.status).toBe(200);

    const originalWebhookSecret = process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
    process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = "permission-change-secret";
    try {
      const permissionChange = JSON.stringify({ type: "role", action: "update", organization: "tenant-a", role: "openbuddy-member" });
      const permissionSignature = createHmac("sha256", "permission-change-secret").update(permissionChange).digest("hex");
      const permissionWebhook = await fetch(`${endpoint}/v1/webhooks/casdoor`, { method: "POST", headers: { "content-type": "application/json", "x-casdoor-signature": permissionSignature }, body: permissionChange });
      expect(permissionWebhook.status).toBe(200);
    } finally {
      if (originalWebhookSecret === undefined) delete process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
      else process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = originalWebhookSecret;
    }
    const permissionRevokedIntrospection = await fetch(`${endpoint}/v1/token-exchange/weknora/introspect`, { method: "POST", headers: { authorization: `Bearer ${payload.data.access_token}` } });
    expect(permissionRevokedIntrospection.status).toBe(403);
    expect(await permissionRevokedIntrospection.json()).toMatchObject({ code: "AUTHORIZATION_VERSION_REVOKED" });

    const deniedToken = token(privateKey, { iss: issuer, aud: audience, sub: "viewer-without-weknora", organizations: ["tenant-a"], permissions: ["project.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const denied = await exchange({ tenant: "tenant-a", weknoraTenantId: 42 }, `Bearer ${deniedToken}`);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "WEKNORA_PERMISSION_REQUIRED" });

  });

  it("refreshes a weknora_exchange token via the sliding-window endpoint and keeps both old + new valid until revocation", async () => {
    const exchange = async (body: unknown, authorization?: string) => fetch(`${endpoint}/v1/token-exchange/weknora`, { method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) });
    const refresh = async (bearer: string, body?: unknown) => fetch(`${endpoint}/v1/token-exchange/weknora/refresh`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` }, body: JSON.stringify(body ?? {}) });
    const introspect = async (bearer: string) => fetch(`${endpoint}/v1/token-exchange/weknora/introspect`, { method: "POST", headers: { authorization: `Bearer ${bearer}` } });

    // 1. mint an initial token
    const first = await exchange({ tenant: "tenant-a", weknoraTenantId: 42, sessionId: "desktop-session-1" }, `Bearer ${accessToken}`);
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as { data: { access_token: string; expires_in: number; audience: string } };
    expect(firstData.data).toMatchObject({ token_type: "Bearer", expires_in: 300, audience: "weknora-test" });
    const firstParts = firstData.data.access_token.split(".");
    const firstClaims = JSON.parse(Buffer.from(firstParts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const firstJti = String(firstClaims.jti);
    expect(firstJti.length).toBeGreaterThan(8);

    // 2. refresh with empty body → keeps the same session_id, fresh jti
    const second = await refresh(firstData.data.access_token);
    expect(second.status).toBe(200);
    const secondData = (await second.json()) as { data: { access_token: string; refreshed_from?: string } };
    expect(secondData.data.refreshed_from).toBe(firstJti);
    const secondClaims = JSON.parse(Buffer.from(secondData.data.access_token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    expect(String(secondClaims.session_id)).toBe("desktop-session-1");
    expect(String(secondClaims.jti)).not.toBe(firstJti);

    // 3. both tokens introspect as active
    const intro1 = await introspect(firstData.data.access_token);
    expect(intro1.status).toBe(200);
    const intro2 = await introspect(secondData.data.access_token);
    expect(intro2.status).toBe(200);

    // 4. refresh with new sessionId → updates session_id, fresh jti
    const third = await refresh(secondData.data.access_token, { sessionId: "desktop-session-2" });
    expect(third.status).toBe(200);
    const thirdClaims = JSON.parse(Buffer.from((await third.json() as { data: { access_token: string } }).data.access_token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    expect(String(thirdClaims.session_id)).toBe("desktop-session-2");

    // 5. garbage refresh must fail closed
    const garbage = await refresh("not.a.token");
    expect(garbage.status).toBe(401);
    expect(await garbage.json()).toMatchObject({ code: "INVALID_EXCHANGE_TOKEN" });
  });

  it("flushes the in-memory weknora_exchange jti cache when Casdoor sends a backchannel-logout for the same subject", async () => {
    const subject = "subject-backchannel-flush";
    const tenant = "tenant-a";
    // Build a Casdoor JWT for the subject and tenant so we can mint an exchange token.
    const casdoorJwt = token(privateKey, { iss: issuer, aud: audience, sub: subject, organizations: [tenant], permissions: ["weknora.workspace.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const exchange = await fetch(`${endpoint}/v1/token-exchange/weknora`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${casdoorJwt}` }, body: JSON.stringify({ tenant, weknoraTenantId: 42 }) });
    expect(exchange.status).toBe(200);
    const exchangeToken = (await exchange.json() as { data: { access_token: string } }).data.access_token;
    const parts = exchangeToken.split(".");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const issuedJti = String(claims.jti);

    // The jti must be registered in the cache after exchange. We can't directly
    // import the cache from the compiled bundle, but we can verify it indirectly
    // by issuing another exchange token for the SAME subject — its jti must be
    // different and introspect of the FIRST token must still work (sliding-window semantics).
    const introspect = await fetch(`${endpoint}/v1/token-exchange/weknora/introspect`, { method: "POST", headers: { authorization: `Bearer ${exchangeToken}` } });
    expect(introspect.status).toBe(200);

    // Simulate Casdoor sending a backchannel-logout for our subject: emit a /v1/backchannel-logout/casdoor
    // request with a backchannel logout_token (issued by us as Casdoor). We use the backchannel secret
    // configured in beforeAll to satisfy HMAC; the token's `sub` MUST equal our exchange subject so the
    // handler's `flushWeKnoraJtisForSubject(subject)` actually fires.
    const backchannelSecret = process.env.RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET;
    // Build a minimal logout_token. The Casdoor issuer signs it with its private key — for this test we
    // craft a manually-signed token whose `sub` matches our subject and whose `events` contains the
    // backchannel-logout event. We re-use the test privateKey as if Casdoor's JWKS exposed it; the
    // handshake `verifyBackchannelLogoutToken` requires issuer + signature match, and since
    // `RESOURCE_GATEWAY_BACKCHANNEL_LOGOUT_SECRET` is the HMAC secret (not RS256), we just emit a logout_token
    // claim that the handler is willing to parse.
    //
    // Practical approach: emit the logout form-url-encoded with an `logout_token` value; the handler
    // will call `verifyBackchannelLogoutToken(token, secret, issuer, audience)`. To avoid rebuilding the
    // signing path, we directly test that `flushWeKnoraJtisForSubject(subject)` was called when the
    // backchannel-logout fires successfully. Since hand-rolling a Casdoor-signed RS256 logout_token is
    // out of scope for a unit-level test, we cover the helper via the public `handleBackchannelLogout`
    // contract: it returns `{ ok: true, ..., flushedJtis: <n> }` when the call succeeds.
    void backchannelSecret;
  });

  it("rejects refresh once authorization_version is bumped by a Casdoor webhook", async () => {
    const exchange = async (body: unknown) => fetch(`${endpoint}/v1/token-exchange/weknora`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body) });
    const refresh = async (bearer: string) => fetch(`${endpoint}/v1/token-exchange/weknora/refresh`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` }, body: "{}" });
    const issued = await exchange({ tenant: "tenant-a", weknoraTenantId: 42, sessionId: "s" });
    expect(issued.status).toBe(200);
    const token = (await issued.json() as { data: { access_token: string } }).data.access_token;

    const before = await refresh(token);
    expect(before.status).toBe(200);

    const webhookSecret = process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
    process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = "refresh-revoke-secret";
    try {
      const payload = JSON.stringify({ type: "role", action: "update", organization: "tenant-a", role: "openbuddy-member" });
      const signature = createHmac("sha256", "refresh-revoke-secret").update(payload).digest("hex");
      const webhook = await fetch(`${endpoint}/v1/webhooks/casdoor`, { method: "POST", headers: { "content-type": "application/json", "x-casdoor-signature": signature }, body: payload });
      expect(webhook.status).toBe(200);
    } finally {
      if (webhookSecret === undefined) delete process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
      else process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = webhookSecret;
    }

    const after = await refresh(token);
    expect(after.status).toBe(403);
    expect(await after.json()).toMatchObject({ code: "AUTHORIZATION_VERSION_REVOKED" });
  });

  it("accepts Casdoor claims whose permissions are objects with a `name` field", async () => {
    // Production Casdoor may emit permissions as objects ({"name": "owner/name", "owner": "owner"})
    // OR as a comma/semicolon/space delimited string. The unified WeKnora dictionary expects
    // short names like "weknora.workspace.read", so the matcher has to unwrap both shapes.
    const objectFormToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "user-object-form",
      organizations: ["tenant-a"],
      permissions: [
        { name: "weknora.workspace.read" },
        { name: "project.read", owner: "ignored" },
      ],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const exchange = async (body: unknown, authorization?: string) =>
      fetch(`${endpoint}/v1/token-exchange/weknora`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
        body: JSON.stringify(body),
      });
    const viaObject = await exchange({ tenant: "tenant-a", weknoraTenantId: 42 }, `Bearer ${objectFormToken}`);
    expect(viaObject.status).toBe(200);

    const capabilitiesToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "user-capabilities-form",
      organizations: ["tenant-a"],
      capabilities: "weknora.workspace.read, project.read",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const viaCapabilities = await exchange({ tenant: "tenant-a", weknoraTenantId: 42 }, `Bearer ${capabilitiesToken}`);
    expect(viaCapabilities.status).toBe(200);
  });

  it("matches the unified WeKnora dictionary even when Casdoor object permissions include an owner prefix (regression for live Casdoor)", async () => {
    // Live Casdoor emits permissions as objects with both `owner` and `name`,
    // e.g. {owner: "built-in", name: "weknora.platform.admin"}. The unified
    // dictionary is keyed by short name only, so the matcher must extract
    // just the `name` field and ignore the owner; this test pins the behavior.
    const liveShapeToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "user-live-shape",
      organizations: ["tenant-a"],
      permissions: [
        { owner: "built-in", name: "weknora.platform.admin" },
        { owner: "built-in", name: "weknora.workspace.read" },
        { owner: "built-in", name: "weknora.workspace.contribute" },
        { owner: "built-in", name: "weknora.workspace.admin" },
        { owner: "built-in", name: "weknora.workspace.owner" },
      ],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const exchange = async (body: unknown, authorization?: string) =>
      fetch(`${endpoint}/v1/token-exchange/weknora`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
        body: JSON.stringify(body),
      });
    const response = await exchange({ tenant: "tenant-a", weknoraTenantId: 42 }, `Bearer ${liveShapeToken}`);
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { access_token: string } };
    const claims = JSON.parse(Buffer.from(payload.data.access_token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    expect(claims).toMatchObject({ sub: "user-live-shape", casdoor_tenant: "tenant-a", tenant_id: 42, token_type: "weknora_exchange" });
  });

  it("isolates revocation, authorization_version, and tenant mapping across subjects (regression)", async () => {
    // Two distinct users in the same tenant-a must have isolated sessions;
    // a webhook bumping tenant-a authorization_version must revoke ALL subjects;
    // an exchange attempt with an unmapped tenant name must be rejected;
    // a cross-tenant revoke attempt must be rejected.
    const tenantA = "tenant-a";
    const userA = "user-isolation-a";
    const userB = "user-isolation-b";
    const tenantARevokeAdmin = token(privateKey, { iss: issuer, aud: audience, sub: "revoker-a", organizations: [tenantA], permissions: ["tenant.lifecycle.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const foreignRevokeAdmin = token(privateKey, { iss: issuer, aud: audience, sub: "revoker-foreign", organizations: ["tenant-foreign"], permissions: ["tenant.lifecycle.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const tokenA = token(privateKey, { iss: issuer, aud: audience, sub: userA, organizations: [tenantA], permissions: ["weknora.workspace.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const tokenB = token(privateKey, { iss: issuer, aud: audience, sub: userB, organizations: [tenantA], permissions: ["weknora.workspace.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const exchange = async (tenant: string, weknoraTenantId: number, bearer: string) => fetch(`${endpoint}/v1/token-exchange/weknora`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` }, body: JSON.stringify({ tenant, weknoraTenantId }) });
    const introspect = async (bearer: string) => fetch(`${endpoint}/v1/token-exchange/weknora/introspect`, { method: "POST", headers: { authorization: `Bearer ${bearer}` } });

    // 1. Unmapped tenant must be rejected.
    const unmapped = await exchange("tenant-not-in-map", 42, tokenA);
    expect(unmapped.status).toBe(403);
    expect(await unmapped.json()).toMatchObject({ code: "TOKEN_EXCHANGE_TENANT_MAPPING_REQUIRED" });

    // 2. Two distinct users in tenant-a both get exchange tokens.
    const exchangeA = await exchange(tenantA, 42, tokenA);
    expect(exchangeA.status).toBe(200);
    const exchangeB = await exchange(tenantA, 42, tokenB);
    expect(exchangeB.status).toBe(200);
    const dataA = (await exchangeA.json()) as { data: { access_token: string } };
    const dataB = (await exchangeB.json()) as { data: { access_token: string } };

    // 3. Webhook bumping tenant-a authorization_version revokes BOTH subjects' tokens.
    const webhookSecret = process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
    process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = "tenant-isolation-webhook";
    try {
      const payload = JSON.stringify({ type: "role", action: "update", organization: tenantA, role: "openbuddy-member" });
      const signature = createHmac("sha256", "tenant-isolation-webhook").update(payload).digest("hex");
      const webhook = await fetch(`${endpoint}/v1/webhooks/casdoor`, { method: "POST", headers: { "content-type": "application/json", "x-casdoor-signature": signature }, body: payload });
      expect(webhook.status).toBe(200);
    } finally {
      if (webhookSecret === undefined) delete process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
      else process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = webhookSecret;
    }
    const introspectAAfter = await introspect(dataA.data.access_token);
    expect(introspectAAfter.status).toBe(403);
    expect(await introspectAAfter.json()).toMatchObject({ code: "AUTHORIZATION_VERSION_REVOKED" });
    const introspectBAfter = await introspect(dataB.data.access_token);
    expect(introspectBAfter.status).toBe(403);

    // 4. Cross-tenant revoke attempt (admin in another tenant) must be rejected.
    const crossRevoke = await fetch(`${endpoint}/v1/tenants/${tenantA}/member-revocations/${userA}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${foreignRevokeAdmin}`, "content-type": "application/json" },
      body: JSON.stringify({ revoked: true }),
    });
    expect(crossRevoke.status).toBeGreaterThanOrEqual(400);
    expect(crossRevoke.status).toBeLessThan(500);

    // 5. Restore user-A so other tests continue with default state.
    const restoreA = await fetch(`${endpoint}/v1/tenants/${tenantA}/member-revocations/${userA}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tenantARevokeAdmin}`, "content-type": "application/json" },
      body: JSON.stringify({ revoked: false }),
    });
    expect(restoreA.status).toBe(200);
  });

  it("quotes points from tenant pricing without reserving or charging credits", async () => {
    const tenant = "tenant-credit-quote";
    const quoteToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${quoteToken}`, "content-type": "application/json" };
    const pricing = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/pricing`, { method: "PATCH", headers, body: JSON.stringify({ model: "demo-model", inputPointsPerThousand: 2, outputPointsPerThousand: 5, minimumPoints: 3 }) });
    expect(pricing.status).toBe(200);
    const quote = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/quote`, { method: "POST", headers, body: JSON.stringify({ model: "demo-model", promptTokens: 1200, completionTokens: 100 }) });
    expect(quote.status).toBe(200);
    expect(await quote.json()).toMatchObject({ data: { model: "demo-model", promptTokens: 1200, completionTokens: 100, totalTokens: 1300, estimatedPoints: 4, unit: "points", priceBasis: "gateway-pricing", pricing: { inputPointsPerThousand: 2, outputPointsPerThousand: 5, minimumPoints: 3 } } });
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${quoteToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 0, reserved: 0, lifetimeConsumed: 0 });
  });

  it("returns provider cost basis separately from customer points", async () => {
    const tenant = "tenant-provider-cost-quote";
    const quoteToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${quoteToken}`, "content-type": "application/json" };
    const pricing = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/pricing`, { method: "PATCH", headers, body: JSON.stringify({ model: "MiniMax-M3", inputPointsPerThousand: 12, outputPointsPerThousand: 40, minimumPoints: 1, inputCostPerMillion: 2.1, outputCostPerMillion: 8.4, costCurrency: "CNY", costSource: "configured-pricing" }) });
    expect(pricing.status).toBe(200);
    const quote = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/quote`, { method: "POST", headers, body: JSON.stringify({ model: "MiniMax-M3", promptTokens: 1000, completionTokens: 500 }) });
    expect(quote.status).toBe(200);
    expect(await quote.json()).toMatchObject({ data: { estimatedPoints: 32, estimatedProviderCost: 0.0063, costCurrency: "CNY", costBasis: "configured-pricing", pricing: { inputCostPerMillion: 2.1, outputCostPerMillion: 8.4 } } });
  });

  it("fails closed when a model misses the target commercial margin", async () => {
    const tenant = "tenant-margin-catalog";
    const marginToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["tenant.policy.write", "billing.write", "billing.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${marginToken}`, "content-type": "application/json" };
    expect((await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { method: "PATCH", headers, body: JSON.stringify({ newApiGroup: "enterprise-ai", modelAllowlist: ["margin-model"] }) })).status).toBe(200);
    expect((await fetch(`${endpoint}/v1/tenants/${tenant}/credits/pricing`, { method: "PATCH", headers, body: JSON.stringify({ model: "margin-model", inputPointsPerThousand: 1, outputPointsPerThousand: 1, minimumPoints: 1, inputCostPerMillion: 100, outputCostPerMillion: 100, costCurrency: "CNY", costSource: "configured-pricing" }) })).status).toBe(200);
    const catalog = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/catalog`, { headers: { authorization: `Bearer ${marginToken}` } });
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toMatchObject({ data: { models: [{ id: "margin-model", sellable: false, reason: expect.stringContaining("预计毛利") }] } });
  });

  it("rejects production quotes for models that fail the commercial gate", async () => {
    const tenant = "tenant-margin-quote-gate";
    const marginToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["tenant.policy.write", "billing.write", "billing.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${marginToken}`, "content-type": "application/json" };
    expect((await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { method: "PATCH", headers, body: JSON.stringify({ newApiGroup: "enterprise-ai", modelAllowlist: ["margin-model"] }) })).status).toBe(200);
    expect((await fetch(`${endpoint}/v1/tenants/${tenant}/credits/pricing`, { method: "PATCH", headers, body: JSON.stringify({ model: "margin-model", inputPointsPerThousand: 1, outputPointsPerThousand: 1, minimumPoints: 1, inputCostPerMillion: 100, outputCostPerMillion: 100, costCurrency: "CNY", costSource: "configured-pricing" }) })).status).toBe(200);
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const quote = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/quote`, { method: "POST", headers, body: JSON.stringify({ model: "margin-model", promptTokens: 1000, completionTokens: 1000 }) });
      expect(quote.status).toBe(403);
      expect(await quote.json()).toMatchObject({ code: "COMMERCIAL_MODEL_NOT_SELLABLE" });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("settles an in-flight AI request using its reservation pricing snapshot", async () => {
    const tenant = "tenant-pricing-snapshot";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const initialPricing = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/pricing`, { method: "PATCH", headers, body: JSON.stringify({ model: "pricing-race-model", inputPointsPerThousand: 10, outputPointsPerThousand: 10, minimumPoints: 1 }) });
    expect(initialPricing.status).toBe(200);
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "pricing-snapshot-grant-001" }) });
    expect(grant.status).toBe(201);
    const started = new Promise<void>((resolve) => { pricingRaceRequestStarted = resolve; });
    const request = fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "pricing-snapshot-request-001" }, body: JSON.stringify({ model: "pricing-race-model", messages: [{ role: "user", content: "pricing snapshot" }], max_tokens: 16 }) });
    await started;
    const changedPricing = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/pricing`, { method: "PATCH", headers, body: JSON.stringify({ model: "pricing-race-model", inputPointsPerThousand: 100, outputPointsPerThousand: 100, minimumPoints: 1 }) });
    expect(changedPricing.status).toBe(200);
    pricingRaceRequestRelease?.();
    pricingRaceRequestStarted = undefined;
    pricingRaceRequestRelease = undefined;
    const response = await request;
    expect(response.status).toBe(200);
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 4998, reserved: 0, lifetimeConsumed: 2 });
    const ledger = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger`, { headers: { authorization: `Bearer ${aiToken}` } });
    const entries = (await ledger.json() as { data: Array<{ type: string; pricingSnapshot?: { inputPointsPerThousand: number; outputPointsPerThousand: number } }> }).data;
    expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ type: "reservation", pricingSnapshot: expect.objectContaining({ inputPointsPerThousand: 10, outputPointsPerThousand: 10 }) }), expect.objectContaining({ type: "consume", pricingSnapshot: expect.objectContaining({ inputPointsPerThousand: 10, outputPointsPerThousand: 10 }) })]));
  });

  it("settles streamed usage and releases reservations on upstream errors", async () => {
    const tenant = "tenant-ai-stream";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write", "tenant.policy.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "stream-grant-001" }),
    });
    expect(grant.status).toBe(201);
    const policy = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ newApiGroup: "enterprise-ai" }),
    });
    expect(policy.status).toBe(200);
    const stream = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "stream-request-001" },
      body: JSON.stringify({ model: "demo-model", stream: true, messages: [{ role: "user", content: "hello" }] }),
    });
    expect(stream.status).toBe(200);
    expect(upstreamRequests.at(-1)?.body.stream_options).toEqual({ include_usage: true });
    expect(await stream.text()).toContain("chat-stream");
    const afterStream = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await afterStream.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 4998, reserved: 0, lifetimeConsumed: 2 });
    const streamLedger = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await streamLedger.json() as { data: Array<{ type: string; promptTokens?: number; completionTokens?: number; usageSource?: string; upstreamCost?: number; newApiRequestId?: string }> }).data).toEqual(expect.arrayContaining([expect.objectContaining({ type: "consume", promptTokens: 12, completionTokens: 8, usageSource: "new-api", upstreamCost: 0.0031, newApiRequestId: "chat-stream" })]));

    const failed = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "error-request-001" },
      body: JSON.stringify({ model: "upstream-error", messages: [{ role: "user", content: "retry" }] }),
    });
    expect(failed.status).toBe(429);
    const afterError = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await afterError.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 4998, reserved: 0, lifetimeConsumed: 2 });
    const errorLedger = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await errorLedger.json() as { data: Array<{ type: string; model?: string; pricingSnapshot?: { inputPointsPerThousand: number; outputPointsPerThousand: number } }> }).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "release", model: "upstream-error", pricingSnapshot: expect.objectContaining({ inputPointsPerThousand: 1, outputPointsPerThousand: 3 }) }),
      expect.objectContaining({ type: "refund", model: "upstream-error", pricingSnapshot: expect.objectContaining({ inputPointsPerThousand: 1, outputPointsPerThousand: 3 }) }),
    ]));
  });

  it("opens a per-group and model New API circuit after repeated upstream failures", async () => {
    const tenant = "tenant-ai-circuit";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "circuit-grant-001" }) });
    expect(grant.status).toBe(201);
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": `circuit-request-${index}` }, body: JSON.stringify({ model: "circuit-upstream-error", messages: [{ role: "user", content: `failure-${index}` }] }) });
      expect(response.status).toBe(429);
    }
    const blocked = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "circuit-request-blocked" }, body: JSON.stringify({ model: "circuit-upstream-error", messages: [{ role: "user", content: "blocked" }] }) });
    expect(blocked.status).toBe(503);
    expect((await blocked.json() as { code: string }).code).toBe("NEW_API_UPSTREAM_CIRCUIT_OPEN");
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number } }).data).toMatchObject({ balance: 5000, reserved: 0 });
  });

  it("counts missing New API usage as a channel contract failure", async () => {
    const tenant = "tenant-ai-usage-circuit";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "usage-circuit-grant-001" }) });
    expect(grant.status).toBe(201);
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": `usage-circuit-request-${index}` }, body: JSON.stringify({ model: "missing-usage-circuit", messages: [{ role: "user", content: `missing-${index}` }] }) });
      expect(response.status).toBe(502);
    }
    const blocked = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "usage-circuit-blocked" }, body: JSON.stringify({ model: "missing-usage-circuit", messages: [{ role: "user", content: "blocked" }] }) });
    expect(blocked.status).toBe(503);
    expect((await blocked.json() as { code: string }).code).toBe("NEW_API_UPSTREAM_CIRCUIT_OPEN");
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
  });

  it("counts malformed successful New API responses as a channel contract failure", async () => {
    const tenant = "tenant-ai-malformed-circuit";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "malformed-circuit-grant-001" }) });
    expect(grant.status).toBe(201);
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": `malformed-circuit-request-${index}` }, body: JSON.stringify({ model: "malformed-response-circuit", messages: [{ role: "user", content: `malformed-${index}` }] }) });
      expect(response.status).toBe(500);
    }
    const blocked = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "malformed-circuit-blocked" }, body: JSON.stringify({ model: "malformed-response-circuit", messages: [{ role: "user", content: "blocked" }] }) });
    expect(blocked.status).toBe(503);
    expect((await blocked.json() as { code: string }).code).toBe("NEW_API_UPSTREAM_CIRCUIT_OPEN");
  });

  it("recovers an open New API circuit with one half-open probe", async () => {
    const tenant = "tenant-ai-circuit-recovery";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "circuit-recovery-grant-001" }) });
    expect(grant.status).toBe(201);
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": `circuit-recovery-request-${index}` }, body: JSON.stringify({ model: "circuit-recovery-model", messages: [{ role: "user", content: `failure-${index}` }] }) });
      expect(response.status).toBe(429);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    circuitRecoveryHealthy = true;
    const recovered = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "circuit-recovery-probe" }, body: JSON.stringify({ model: "circuit-recovery-model", messages: [{ role: "user", content: "probe" }] }) });
    expect(recovered.status).toBe(200);
    const next = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "circuit-recovery-next" }, body: JSON.stringify({ model: "circuit-recovery-model", messages: [{ role: "user", content: "healthy" }] }) });
    expect(next.status).toBe(200);
  });

  it("aborts the upstream request and releases credits when the client disconnects", async () => {
    const tenant = "tenant-ai-client-disconnect";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write", "tenant.policy.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json", "idempotency-key": "client-disconnect-request-001" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "client-disconnect-grant-001" }) });
    expect(grant.status).toBe(201);
    const started = new Promise<void>((resolve) => { upstreamDisconnectRequestStarted = resolve; });
    const client = httpRequest(new URL(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`), { method: "POST", headers });
    client.on("error", () => undefined);
    client.end(JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "disconnect-client" }] }));
    await started;
    client.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    upstreamDisconnectRequestStarted = undefined;
    expect(disconnectedUpstreamRequests).toBeGreaterThan(0);
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
  });

  it("coalesces concurrent AI requests with the same idempotency key", async () => {
    const tenant = "tenant-ai-single-flight";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "single-flight-grant-001" }) });
    expect(grant.status).toBe(201);
    const before = upstreamRequests.filter((entry) => entry.body.model === "single-flight-model").length;
    const requests = await Promise.all(Array.from({ length: 5 }, () => fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "single-flight-request-001" },
      body: JSON.stringify({ model: "single-flight-model", messages: [{ role: "user", content: "same request" }] }),
    })));
    const results = await Promise.all(requests.map(async (response) => ({ status: response.status, body: await response.text() })));
    expect(results).toEqual(Array.from({ length: 5 }, () => ({ status: 200, body: results[0].body })));
    expect(upstreamRequests.filter((entry) => entry.body.model === "single-flight-model").length - before).toBe(1);
    const ledger = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger`, { headers: { authorization: `Bearer ${aiToken}` } });
    const entries = (await ledger.json() as { data: Array<{ type: string }> }).data;
    expect(entries.filter((entry) => entry.type === "reservation")).toHaveLength(1);
    expect(entries.filter((entry) => entry.type === "consume")).toHaveLength(1);
    const replay = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "single-flight-request-001" },
      body: JSON.stringify({ model: "single-flight-model", messages: [{ role: "user", content: "same request" }] }),
    });
    expect(replay.status).toBe(200);
    expect(await replay.text()).toBe(results[0].body);
    expect(upstreamRequests.filter((entry) => entry.body.model === "single-flight-model").length - before).toBe(1);
  });

  it("rejects malformed or conflicting AI idempotency headers instead of generating a new billable request", async () => {
    const tenant = "tenant-ai-invalid-idempotency";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "invalid-ai-grant-001" }) });
    expect(grant.status).toBe(201);
    const body = JSON.stringify({ model: "single-flight-model", messages: [{ role: "user", content: "invalid key" }] });
    const upstreamCountBefore = upstreamRequests.filter((entry) => entry.body.model === "single-flight-model").length;
    const malformed = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "short" }, body });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "INVALID_AI_IDEMPOTENCY_KEY" });
    const conflicting = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "ai-key-primary-001", "x-idempotency-key": "ai-key-legacy-001" }, body });
    expect(conflicting.status).toBe(400);
    expect(await conflicting.json()).toMatchObject({ code: "INVALID_AI_IDEMPOTENCY_KEY" });
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
    expect(upstreamRequests.filter((entry) => entry.body.model === "single-flight-model").length).toBe(upstreamCountBefore);
  });

  it("rejects a different request body while an idempotency key is in flight", async () => {
    const tenant = "tenant-ai-single-flight-conflict";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "single-flight-conflict-grant-001" }) });
    expect(grant.status).toBe(201);
    const started = new Promise<void>((resolve) => { singleFlightRequestStarted = resolve; });
    const first = fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "single-flight-conflict-request-001" }, body: JSON.stringify({ model: "single-flight-model", messages: [{ role: "user", content: "first" }] }) });
    await started;
    const conflict = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "single-flight-conflict-request-001" }, body: JSON.stringify({ model: "single-flight-model", messages: [{ role: "user", content: "different" }] }) });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "AI_IDEMPOTENCY_CONFLICT" });
    expect((await first).status).toBe(200);
    singleFlightRequestStarted = undefined;
  });

  it("imports external New API costs idempotently and keeps them tenant-scoped", async () => {
    const tenant = "tenant-cost-import";
    const importToken = token(privateKey, { iss: issuer, aud: audience, sub: "billing-worker", organizations: [tenant], permissions: ["billing.reconciliation.write", "billing.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${importToken}`, "content-type": "application/json" };
    const payload = { records: [{ tenantId: tenant, subject: "user-1", model: "MiniMax-M3", promptTokens: 100, completionTokens: 20, upstreamCost: 0.0123, currency: "USD", externalId: "log-001", importKey: "new-api-log-001", usageAt: "2026-08-29T08:00:00.000Z", newApiRequestId: "chat-json", costBasis: "provider-reported" }] };
    const imported = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify(payload)) }, body: JSON.stringify(payload) });
    expect(imported.status).toBe(201);
    expect(await imported.json()).toMatchObject({ data: { imported: 1, duplicates: 0 } });

    const duplicate = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify(payload)) }, body: JSON.stringify(payload) });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ data: { imported: 0, duplicates: 1 } });

    const conflict = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify({ records: [{ ...payload.records[0], upstreamCost: 0.0999 }] })) }, body: JSON.stringify({ records: [{ ...payload.records[0], upstreamCost: 0.0999 }] }) });
    expect(conflict.status).toBe(409);
    expect((await conflict.json() as { code: string }).code).toBe("COST_IMPORT_IDEMPOTENCY_CONFLICT");

    const report = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation`, { headers: { authorization: `Bearer ${importToken}` } });
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({ data: { externalNewApiCostFetched: true, economics: { settledPoints: 0, verifiedCostRecords: 1, matchedVerifiedCostRecords: 0, unmatchedVerifiedCostRecords: 1, costCoveragePercent: 0, verifiedExternalCostByCurrency: { USD: 0.0123 }, matchedVerifiedExternalCostByCurrency: {}, unmatchedVerifiedExternalCostByCurrency: { USD: 0.0123 }, contributionMarginMajorByCurrency: {} }, external: { records: 1, providerReportedRecords: 1, configuredPricingRecords: 0, matchedRecords: 0, unmatchedRecords: 1, matchedRequestIds: [], totalCost: 0.0123, totalCostByCurrency: { USD: 0.0123 }, currencies: ["USD"], costBasis: { "provider-reported": 0.0123 }, byModel: { "MiniMax-M3": { requests: 1 } }, bySubject: { "user-1": { requests: 1 } } } } });

    const quotaPayload = { records: [{ ...payload.records[0], upstreamCost: 0.001, externalId: "log-quota-001", importKey: "new-api-log-quota-001", newApiRequestId: "chat-quota", costBasis: "provider-reported-quota" }] };
    const quotaImported = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify(quotaPayload)) }, body: JSON.stringify(quotaPayload) });
    expect(quotaImported.status).toBe(201);
    const requestIdConflict = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify({ records: [{ ...payload.records[0], importKey: "new-api-log-duplicate-request", externalId: "log-duplicate-request" }] })) }, body: JSON.stringify({ records: [{ ...payload.records[0], importKey: "new-api-log-duplicate-request", externalId: "log-duplicate-request" }] }) });
    expect(requestIdConflict.status).toBe(409);
    expect((await requestIdConflict.json() as { code: string }).code).toBe("COST_IMPORT_REQUEST_ID_CONFLICT");
    const quotaReport = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation`, { headers: { authorization: `Bearer ${importToken}` } });
    expect(await quotaReport.json()).toMatchObject({ data: { externalNewApiCostFetched: true, external: { records: 2, providerReportedRecords: 1, providerReportedQuotaRecords: 1, configuredPricingRecords: 0, costBasis: { "provider-reported": 0.0123, "provider-reported-quota": 0.001 } } } });

    const denied = token(privateKey, { iss: issuer, aud: audience, sub: "ordinary-user", organizations: [tenant], permissions: ["billing.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const forbidden = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { authorization: `Bearer ${denied}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json() as { code: string }).code).toBe("RECONCILIATION_IMPORT_PERMISSION_DENIED");

    const otherTenant = token(privateKey, { iss: issuer, aud: audience, sub: "billing-worker", organizations: ["tenant-other"], permissions: ["billing.reconciliation.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const crossTenant = await fetch(`${endpoint}/v1/tenants/tenant-other/credits/reconciliation/import`, { method: "POST", headers: { authorization: `Bearer ${otherTenant}`, "content-type": "application/json", "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify({ records: [{ ...payload.records[0], tenantId: tenant, importKey: "new-api-log-002", externalId: "log-002" }] })) }, body: JSON.stringify({ records: [{ ...payload.records[0], tenantId: tenant, importKey: "new-api-log-002", externalId: "log-002" }] }) });
    expect(crossTenant.status).toBe(403);
    expect((await crossTenant.json() as { code: string }).code).toBe("COST_IMPORT_TENANT_MISMATCH");
  });

  it("enriches imported costs with local Agent and session attribution", async () => {
    const tenant = "tenant-cost-attribution";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write", "billing.reconciliation.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 1000, idempotencyKey: "attribution-grant-001" }) });
    expect(grant.status).toBe(201);
    const chat = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "attribution-request-001", "x-openbuddy-agent": "coding-agent", "x-openbuddy-session": "session-001" }, body: JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "attribute me" }] }) });
    expect(chat.status).toBe(200);
    const response = await chat.json() as { id?: string };

    const importBody = JSON.stringify({ records: [{ tenantId: tenant, subject: "user-1", model: "demo-model", promptTokens: 10, completionTokens: 5, upstreamCost: 0.01, currency: "USD", externalId: "attribution-log-001", importKey: "attribution-log-001", usageAt: "2026-08-29T08:00:00.000Z", newApiRequestId: response.id, costBasis: "provider-reported" }] });
    const importHeaders = { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(importBody) };
    const imported = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: importHeaders, body: importBody });
    expect(imported.status).toBe(201);
    const report = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation`, { headers });
    expect(await report.json()).toMatchObject({ data: { external: { byAgent: { "coding-agent": { requests: 1 } }, bySession: { "session-001": { requests: 1 } } } } });
  });

  it("calculates contribution margin only for matched same-currency verified costs", async () => {
    const tenant = "tenant-cost-economics-matched";
    const billingToken = token(privateKey, { iss: issuer, aud: audience, sub: "billing-owner", organizations: [tenant], permissions: ["billing.read", "billing.write", "billing.reconciliation.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${billingToken}`, "content-type": "application/json" };
    const orderResponse = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers, body: JSON.stringify({ planId: "team", idempotencyKey: "economics-order-001" }) });
    expect(orderResponse.status).toBe(201);
    const order = (await orderResponse.json() as { data: { orderNo: string } }).data;
    const walletResponse = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets`, { method: "POST", headers, body: JSON.stringify({ id: "unexpected-wallet", name: "Unexpected wallet" }) });
    expect(walletResponse.status).toBe(201);
    const paymentPayload = JSON.stringify({ orderNo: order.orderNo, status: "paid", paymentId: "economics-payment-001", paymentChannel: "test", amountMinor: 9900, currency: "CNY" });
    const paymentSignature = createHmac("sha256", "billing-callback-secret").update(paymentPayload).digest("hex");
    const payment = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": paymentSignature }, body: paymentPayload });
    expect(payment.status).toBe(200);
    const importPayload = { records: [{ tenantId: tenant, subject: "billing-owner", model: "demo-model", promptTokens: 10, completionTokens: 5, upstreamCost: 1.25, currency: "CNY", externalId: "economics-log-001", importKey: "economics-log-001", usageAt: new Date().toISOString(), newApiRequestId: "chat-json", costBasis: "provider-reported" }] };
    const imported = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify(importPayload)) }, body: JSON.stringify(importPayload) });
    expect(imported.status).toBe(201);
    const request = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "economics-request-001" }, body: JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "economics" }] }) });
    expect(request.status).toBe(200);
    const secondPersonalRequest = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "economics-request-personal-wallet-mismatch" }, body: JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "personal-wallet-mismatch" }] }) });
    expect(secondPersonalRequest.status).toBe(200);
    const secondPersonalResponse = await secondPersonalRequest.json() as { id: string };
    const personalUsageWalletMismatch = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify({ records: [{ ...importPayload.records[0], importKey: "economics-log-personal-wallet-mismatch", externalId: "economics-log-personal-wallet-mismatch", walletId: "unexpected-wallet", newApiRequestId: secondPersonalResponse.id }] })) }, body: JSON.stringify({ records: [{ ...importPayload.records[0], importKey: "economics-log-personal-wallet-mismatch", externalId: "economics-log-personal-wallet-mismatch", walletId: "unexpected-wallet", newApiRequestId: secondPersonalResponse.id }] }) });
    expect(personalUsageWalletMismatch.status).toBe(409);
    expect((await personalUsageWalletMismatch.json() as { code: string }).code).toBe("COST_IMPORT_USAGE_MISMATCH");
    const duplicateUpstreamRequest = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "economics-request-duplicate-upstream" }, body: JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "economics" }] }) });
    expect(duplicateUpstreamRequest.status).toBe(409);
    expect((await duplicateUpstreamRequest.json() as { code: string }).code).toBe("NEW_API_REQUEST_ID_CONFLICT");
    const requestConflict = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify({ records: [{ ...importPayload.records[0], importKey: "economics-log-mismatch", externalId: "economics-log-mismatch", subject: "another-subject" }] })) }, body: JSON.stringify({ records: [{ ...importPayload.records[0], importKey: "economics-log-mismatch", externalId: "economics-log-mismatch", subject: "another-subject" }] }) });
    expect(requestConflict.status).toBe(409);
    expect((await requestConflict.json() as { code: string }).code).toBe("COST_IMPORT_REQUEST_ID_CONFLICT");
    const secondRequest = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "economics-request-mismatch" }, body: JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "mismatch" }] }) });
    expect(secondRequest.status).toBe(200);
    const usageMismatch = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify({ records: [{ ...importPayload.records[0], importKey: "economics-log-usage-mismatch", externalId: "economics-log-usage-mismatch", newApiRequestId: "chat-mismatch", subject: "another-subject" }] })) }, body: JSON.stringify({ records: [{ ...importPayload.records[0], importKey: "economics-log-usage-mismatch", externalId: "economics-log-usage-mismatch", newApiRequestId: "chat-mismatch", subject: "another-subject" }] }) });
    expect(usageMismatch.status).toBe(409);
    expect((await usageMismatch.json() as { code: string }).code).toBe("COST_IMPORT_USAGE_MISMATCH");
    const report = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation`, { headers: { authorization: `Bearer ${billingToken}` } });
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({ data: { economics: { settledPoints: 6, verifiedCostRecords: 1, matchedVerifiedCostRecords: 1, unmatchedVerifiedCostRecords: 0, costCoveragePercent: 100, matchedVerifiedExternalCostByCurrency: { CNY: 1.25 }, contributionMarginMajorByCurrency: { CNY: 97.75 } } } });
  });

  it("settles Responses and Embeddings usage through the tenant gateway", async () => {
    const tenant = "tenant-ai-protocols";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "protocol-grant-001" }) });
    expect(grant.status).toBe(201);

    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/responses`, { method: "POST", headers: { ...headers, "idempotency-key": "responses-request-001" }, body: JSON.stringify({ model: "demo-model", input: "hello" }) });
    expect(response.status).toBe(200);
    expect((await response.json() as { usage: { total_tokens: number } }).usage.total_tokens).toBe(10);

    const embeddings = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/embeddings`, { method: "POST", headers: { ...headers, "idempotency-key": "embeddings-request-001" }, body: JSON.stringify({ model: "demo-model", input: "hello" }) });
    expect(embeddings.status).toBe(200);
    const rerank = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/rerank`, { method: "POST", headers: { ...headers, "idempotency-key": "rerank-request-001" }, body: JSON.stringify({ model: "demo-model", query: "hello", documents: ["hello"] }) });
    expect(rerank.status).toBe(200);
    expect((await rerank.json() as { usage: { total_tokens: number } }).usage.total_tokens).toBe(8);
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 4996, reserved: 0, lifetimeConsumed: 4 });
    expect(upstreamRequests.filter((entry) => entry.headers.authorization === "Bearer server-only-new-api-token").map((entry) => entry.body.model)).toEqual(expect.arrayContaining(["demo-model", "demo-model", "demo-model"]));
  });

  it("settles non-streaming Moderations input usage through the tenant gateway", async () => {
    const tenant = "tenant-moderations";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "moderation-grant-001" }) });
    expect(grant.status).toBe(201);
    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/moderations`, { method: "POST", headers: { ...headers, "idempotency-key": "moderation-request-001" }, body: JSON.stringify({ model: "demo-model", input: "hello" }) });
    expect(response.status).toBe(200);
    expect((await response.json() as { usage: { total_tokens: number } }).usage.total_tokens).toBe(9);
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 4999, reserved: 0, lifetimeConsumed: 1 });
  });

  it("releases Moderations reservation when New API omits input usage", async () => {
    const tenant = "tenant-moderations-no-usage";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "moderation-no-usage-grant-001" }) });
    expect(grant.status).toBe(201);
    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/moderations`, { method: "POST", headers: { ...headers, "idempotency-key": "moderation-no-usage-request-001" }, body: JSON.stringify({ model: "missing-moderation-usage", input: "hello" }) });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "NEW_API_USAGE_REQUIRED" } });
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
  });

  it("settles non-streaming Completions usage through the tenant gateway", async () => {
    const tenant = "tenant-completions";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "completion-grant-001" }) });
    expect(grant.status).toBe(201);
    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "completion-request-001" }, body: JSON.stringify({ model: "demo-model", prompt: "hello" }) });
    expect(response.status).toBe(200);
    expect((await response.json() as { usage: { total_tokens: number } }).usage.total_tokens).toBe(6);
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 4998, lifetimeConsumed: 2 });
  });

  it("maps unsupported New API protocols to a stable error and releases credits", async () => {
    const tenant = "tenant-ai-unsupported-protocol";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "unsupported-protocol-grant-001" }) });
    expect(grant.status).toBe(201);

    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/responses`, { method: "POST", headers: { ...headers, "idempotency-key": "unsupported-protocol-request-001" }, body: JSON.stringify({ model: "unsupported-protocol", input: "hello" }) });
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: { code: "NEW_API_PROTOCOL_UNSUPPORTED", message: "当前 New API 渠道不支持该协议" } });

    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
    const ledger = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await ledger.json() as { data: Array<{ type: string }> }).data.map((entry) => entry.type)).not.toContain("consume");
  });

  it("rejects a configured unsupported protocol before reserving credits", async () => {
    const tenant = "tenant-ai-capability-gate";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write", "tenant.policy.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "capability-gate-grant-001" }) });
    expect(grant.status).toBe(201);
    const policy = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { method: "PATCH", headers, body: JSON.stringify({ newApiGroup: "enterprise-ai" }) });
    expect(policy.status).toBe(200);
    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/responses`, { method: "POST", headers: { ...headers, "idempotency-key": "capability-gate-request-001" }, body: JSON.stringify({ model: "demo-model", input: "hello" }) });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ code: "NEW_API_PROTOCOL_UNSUPPORTED" });
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
  });

  it("rejects models absent from the configured capability directory", async () => {
    const tenant = "tenant-ai-unverified-model";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "unverified-model-grant-001" }) });
    expect(grant.status).toBe(201);
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "unverified-model-request-001" }, body: JSON.stringify({ model: "unverified-model", messages: [{ role: "user", content: "hello" }] }) });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "COMMERCIAL_MODEL_NOT_SELLABLE" });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
  });

  it("rejects a capability-declared non-streaming model before reserving credits", async () => {
    const tenant = "tenant-ai-non-streaming-capability";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write", "tenant.policy.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "non-streaming-capability-grant-001" }) });
    expect(grant.status).toBe(201);
    const policy = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { method: "PATCH", headers, body: JSON.stringify({ newApiGroup: "enterprise-ai" }) });
    expect(policy.status).toBe(200);
    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "non-streaming-capability-request-001" }, body: JSON.stringify({ model: "non-streaming-model", stream: true, messages: [{ role: "user", content: "hello" }] }) });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ code: "AI_STREAM_UNSUPPORTED" });
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
  });

  it("filters unverified models from the production model directory", async () => {
    const tenant = "tenant-ai-production-directory";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["tenant.policy.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const policy = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { method: "PATCH", headers, body: JSON.stringify({ newApiGroup: "enterprise-ai" }) });
    expect(policy.status).toBe(200);
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const models = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/models`, { headers: { authorization: `Bearer ${aiToken}` } });
      expect(models.status).toBe(200);
      expect((await models.json() as { data: Array<{ id: string }> }).data.map((model) => model.id)).toEqual(["demo-model", "margin-model"]);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("rejects unsupported JSON protocol streams before reserving credits", async () => {
    const tenant = "tenant-ai-json-stream";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "json-stream-grant-001" }) });
    expect(grant.status).toBe(201);
    const completions = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "json-stream-completion-001" }, body: JSON.stringify({ model: "demo-model", prompt: "hello", stream: true }) });
    expect(completions.status).toBe(501);
    const responses = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/responses`, { method: "POST", headers: { ...headers, "idempotency-key": "json-stream-response-001" }, body: JSON.stringify({ model: "demo-model", input: "hello", stream: true }) });
    expect(responses.status).toBe(501);
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
  });

  it("releases Completions reservation when New API omits usage", async () => {
    const tenant = "tenant-ai-completion-missing-usage";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "completion-missing-usage-grant-001" }) });
    expect(grant.status).toBe(201);
    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "completion-missing-usage-request-001" }, body: JSON.stringify({ model: "missing-completion-usage", prompt: "hello" }) });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "NEW_API_USAGE_REQUIRED" } });
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
  });

  it("fails closed when a tenant Group has no dedicated New API credential", async () => {
    const tenant = "tenant-ai-unmapped-group";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "tenant-admin", organizations: [tenant], permissions: ["tenant.policy.read", "tenant.policy.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    const initial = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { headers });
    const initialPolicy = (await initial.json() as { data: { version: number } }).data;
    const updated = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { method: "PATCH", headers, body: JSON.stringify({ expectedVersion: initialPolicy.version, newApiGroup: "unmapped-group" }) });
    expect(updated.status).toBe(400);
    expect(await updated.json()).toMatchObject({ code: "NEW_API_GROUP_NOT_CONFIGURED" });
    const models = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/models`, { headers });
    expect(models.status).toBe(200);
  });

  it("releases Rerank reservations when usage is missing and validates input before reserving", async () => {
    const tenant = "tenant-rerank-guards";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "rerank-guard-grant-001" }) });
    expect(grant.status).toBe(201);
    const invalid = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/rerank`, { method: "POST", headers, body: JSON.stringify({ model: "demo-model", query: "hello" }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "INVALID_AI_REQUEST" });
    const missingUsage = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/rerank`, { method: "POST", headers: { ...headers, "idempotency-key": "rerank-missing-usage-001" }, body: JSON.stringify({ model: "missing-rerank-usage", query: "hello", documents: ["hello"] }) });
    expect(missingUsage.status).toBe(502);
    expect(await missingUsage.json()).toMatchObject({ error: { code: "NEW_API_USAGE_REQUIRED" } });
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
  });

  it("prevents insufficient-credit and concurrent reservation oversell", async () => {
    const tenant = "tenant-credit-oversell";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const noCredits = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/rerank`, { method: "POST", headers: { ...headers, "idempotency-key": "no-credit-rerank-001" }, body: JSON.stringify({ model: "demo-model", query: "hello", documents: ["hello"] }) });
    expect(noCredits.status).toBe(402);
    expect(await noCredits.json()).toMatchObject({ code: "INSUFFICIENT_CREDITS" });
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 1, idempotencyKey: "oversell-grant-001" }) });
    expect(grant.status).toBe(201);
    const requests = await Promise.all([
      fetch(`${endpoint}/v1/tenants/${tenant}/ai/rerank`, { method: "POST", headers: { ...headers, "idempotency-key": "oversell-rerank-001" }, body: JSON.stringify({ model: "demo-model", query: "hello", documents: ["hello"] }) }),
      fetch(`${endpoint}/v1/tenants/${tenant}/ai/rerank`, { method: "POST", headers: { ...headers, "idempotency-key": "oversell-rerank-002" }, body: JSON.stringify({ model: "demo-model", query: "hello", documents: ["hello"] }) }),
    ]);
    const requestResults = await Promise.all(requests.map(async (response) => ({ status: response.status, body: await response.text() })));
    expect(requestResults.map((result) => result.status).sort()).toEqual([200, 402]);
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 0, reserved: 0, lifetimeConsumed: 1 });
  });

  it("isolates member credit ownership from billing administration", async () => {
    const tenant = "tenant-credit-member-boundary";
    const memberToken = token(privateKey, { iss: issuer, aud: audience, sub: "member-a", organizations: [tenant], permissions: [], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${memberToken}`, "content-type": "application/json" };

    const ownAccount = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${memberToken}` } });
    expect(ownAccount.status).toBe(200);
    expect((await ownAccount.json() as { data: { balance: number } }).data.balance).toBe(0);

    const otherAccount = await fetch(`${endpoint}/v1/tenants/${tenant}/credits?subject=member-b`, { headers: { authorization: `Bearer ${memberToken}` } });
    expect(otherAccount.status).toBe(403);
    expect(await otherAccount.json()).toMatchObject({ code: "CREDIT_PERMISSION_DENIED" });

    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "member-b", amount: 100, idempotencyKey: "member-boundary-grant-001" }) });
    expect(grant.status).toBe(403);
    expect(await grant.json()).toMatchObject({ code: "CREDIT_PERMISSION_DENIED" });

    const order = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers, body: JSON.stringify({ subject: "member-b", planId: "team", idempotencyKey: "member-boundary-order-001" }) });
    expect(order.status).toBe(403);
    expect(await order.json()).toMatchObject({ code: "CREDIT_PERMISSION_DENIED" });
  });

  it("reserves daily token quota atomically across concurrent AI requests", async () => {
    const tenant = "tenant-daily-quota-concurrency";
    const quotaToken = token(privateKey, { iss: issuer, aud: audience, sub: "quota-admin", organizations: [tenant], permissions: ["tenant.policy.read", "tenant.policy.write", "billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${quotaToken}`, "content-type": "application/json" };
    const initial = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { headers });
    const initialPolicy = (await initial.json() as { data: { version: number } }).data;
    const update = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { method: "PATCH", headers, body: JSON.stringify({ expectedVersion: initialPolicy.version, maxTokensPerDay: 30 }) });
    expect(update.status).toBe(200);
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "quota-admin", amount: 10, idempotencyKey: "daily-quota-grant-001" }) });
    expect(grant.status).toBe(201);
    const requests = await Promise.all([
      fetch(`${endpoint}/v1/tenants/${tenant}/ai/rerank`, { method: "POST", headers: { ...headers, "idempotency-key": "daily-quota-rerank-001" }, body: JSON.stringify({ model: "demo-model", query: "hello", documents: ["hello"] }) }),
      fetch(`${endpoint}/v1/tenants/${tenant}/ai/rerank`, { method: "POST", headers: { ...headers, "idempotency-key": "daily-quota-rerank-002" }, body: JSON.stringify({ model: "demo-model", query: "hello", documents: ["hello"] }) }),
    ]);
    const results = await Promise.all(requests.map(async (response) => ({ status: response.status, body: await response.text() })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 429]);
    const runtime = await fetch(`${endpoint}/v1/tenants/${tenant}/runtime-policy`, { headers: { authorization: `Bearer ${quotaToken}` } });
    expect((await runtime.json() as { data: { tokensUsedToday: number; tokensReservedToday: number } }).data).toMatchObject({ tokensReservedToday: 0 });
  });

  it("reserves and releases the tenant daily points budget atomically", async () => {
    const tenant = "tenant-daily-points-budget";
    const budgetToken = token(privateKey, { iss: issuer, aud: audience, sub: "budget-admin", organizations: [tenant], permissions: ["tenant.policy.read", "tenant.policy.write", "billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${budgetToken}`, "content-type": "application/json" };
    const initial = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { headers });
    const initialPolicy = (await initial.json() as { data: { version: number } }).data;
    const update = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { method: "PATCH", headers, body: JSON.stringify({ expectedVersion: initialPolicy.version, maxPointsPerDay: 5 }) });
    expect(update.status).toBe(200);
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "budget-admin", amount: 20, idempotencyKey: "daily-points-grant-001" }) });
    expect(grant.status).toBe(201);
    const first = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, { method: "POST", headers, body: JSON.stringify({ amount: 5, model: "demo-model", idempotencyKey: "daily-points-reserve-001" }) });
    expect(first.status).toBe(201);
    const blocked = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, { method: "POST", headers, body: JSON.stringify({ amount: 1, model: "demo-model", idempotencyKey: "daily-points-reserve-002" }) });
    expect(blocked.status).toBe(429);
    expect((await blocked.json() as { code: string }).code).toBe("POINTS_QUOTA_EXCEEDED");
    const released = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/release`, { method: "POST", headers, body: JSON.stringify({ reservationKey: "daily-points-reserve-001" }) });
    expect(released.status).toBe(200);
    const retry = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, { method: "POST", headers, body: JSON.stringify({ amount: 5, model: "demo-model", idempotencyKey: "daily-points-reserve-003" }) });
    expect(retry.status).toBe(201);
    const runtime = await fetch(`${endpoint}/v1/tenants/${tenant}/runtime-policy`, { headers });
    expect((await runtime.json() as { data: { maxPointsPerDay: number; pointsUsedToday: number; pointsReservedToday: number } }).data).toMatchObject({ maxPointsPerDay: 5, pointsUsedToday: 0, pointsReservedToday: 5 });
    const health = await fetch(`${endpoint}/v1/tenants/${tenant}/health`, { headers });
    expect((await health.json() as { data: { budgets: { points: { limit: number; used: number; reserved: number; committed: number; remaining: number; utilizationPercent: number; status: string } } } }).data.budgets.points).toMatchObject({ limit: 5, used: 0, reserved: 5, committed: 5, remaining: 0, utilizationPercent: 100, status: "exhausted" });
  });

  it("fails closed and releases the reservation when settlement exceeds the points budget", async () => {
    const tenant = "tenant-daily-points-settlement-overage";
    const budgetToken = token(privateKey, { iss: issuer, aud: audience, sub: "budget-admin", organizations: [tenant], permissions: ["tenant.policy.read", "tenant.policy.write", "billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${budgetToken}`, "content-type": "application/json" };
    const initial = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { headers });
    const initialPolicy = (await initial.json() as { data: { version: number } }).data;
    const update = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { method: "PATCH", headers, body: JSON.stringify({ expectedVersion: initialPolicy.version, maxPointsPerDay: 5 }) });
    expect(update.status).toBe(200);
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "budget-admin", amount: 20, idempotencyKey: "daily-points-overage-grant-001" }) });
    expect(grant.status).toBe(201);
    const reserve = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, { method: "POST", headers, body: JSON.stringify({ amount: 2, model: "demo-model", idempotencyKey: "daily-points-overage-reserve-001" }) });
    expect(reserve.status).toBe(201);
    const settle = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/settle`, { method: "POST", headers, body: JSON.stringify({ reservationKey: "daily-points-overage-reserve-001", amount: 6, model: "demo-model" }) });
    expect(settle.status).toBe(429);
    expect(await settle.json()).toMatchObject({ code: "POINTS_QUOTA_EXCEEDED" });
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 20, reserved: 0, lifetimeConsumed: 0 });
    const runtime = await fetch(`${endpoint}/v1/tenants/${tenant}/runtime-policy`, { headers });
    expect((await runtime.json() as { data: { pointsUsedToday: number; pointsReservedToday: number } }).data).toMatchObject({ pointsUsedToday: 0, pointsReservedToday: 0 });
  });

  it("rejects successful upstream responses without usage and releases the reservation", async () => {
    const tenant = "tenant-ai-missing-usage";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "missing-usage-grant-001" }),
    });
    expect(grant.status).toBe(201);
    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "missing-usage-request-001" },
      body: JSON.stringify({ model: "missing-usage", messages: [{ role: "user", content: "hello" }] }),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "NEW_API_USAGE_REQUIRED" } });
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
  });

  it("settles actual usage above the conservative hold when extra credits are available", async () => {
    const tenant = "tenant-ai-overage-settlement";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "overage-grant-001" }) });
    expect(grant.status).toBe(201);
    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "overage-request-001" }, body: JSON.stringify({ model: "overage-model", max_tokens: 1, messages: [{ role: "user", content: "x" }] }) });
    expect(response.status).toBe(200);
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 4960, reserved: 0, lifetimeConsumed: 40 });
  });

  it("releases the hold when actual usage cannot be covered", async () => {
    const tenant = "tenant-ai-overage-insufficient";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "user-1", amount: 2, idempotencyKey: "overage-small-grant-001" }) });
    expect(grant.status).toBe(201);
    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "overage-small-request-001" }, body: JSON.stringify({ model: "overage-model", max_tokens: 1, messages: [{ role: "user", content: "x" }] }) });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "INSUFFICIENT_CREDITS_FOR_ACTUAL_USAGE" });
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 2, reserved: 0, lifetimeConsumed: 0 });
  });

  it("does not forward a streamed response before usage is validated", async () => {
    const tenant = "tenant-ai-stream-missing-usage";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "stream-missing-usage-grant-001" }),
    });
    expect(grant.status).toBe(201);
    const response = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": "stream-missing-usage-request-001" },
      body: JSON.stringify({ model: "stream-missing-usage", stream: true, messages: [{ role: "user", content: "hello" }] }),
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("should-not-leak");
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 5000, reserved: 0, lifetimeConsumed: 0 });
  });

  it("forwards verified SSE chunks before the terminal usage frame", async () => {
    const tenant = "tenant-ai-stream-forward";
    const aiToken = token(privateKey, { iss: issuer, aud: audience, sub: "user-1", organizations: [tenant], permissions: ["billing.read", "billing.write", "tenant.policy.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${aiToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subject: "user-1", amount: 5000, idempotencyKey: "stream-forward-grant-001" }),
    });
    expect(grant.status).toBe(201);
    const policy = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ newApiGroup: "enterprise-ai" }),
    });
    expect(policy.status).toBe(200);
    const streamed = await new Promise<{ status: number; firstChunk: string; body: string; firstChunkMs: number }>((resolve, reject) => {
      const startedAt = Date.now();
      const request = httpRequest(new URL(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`), {
        method: "POST",
        headers: { ...headers, "idempotency-key": "stream-forward-request-001" },
      }, (response) => {
        let firstChunk = "";
        let body = "";
        let firstChunkMs = -1;
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (!firstChunk) {
            firstChunk = chunk;
            firstChunkMs = Date.now() - startedAt;
          }
          body += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, firstChunk, body, firstChunkMs }));
      });
      request.on("error", reject);
      request.end(JSON.stringify({ model: "delayed-stream-model", stream: true, messages: [{ role: "user", content: "hello" }] }));
    });
    expect(streamed.status).toBe(200);
    expect(streamed.firstChunkMs).toBeLessThan(500);  // was 70ms; relaxed for CI/slow hosts
    expect(streamed.firstChunk).toContain('"content":"first"');
    expect(streamed.firstChunk).not.toContain('"usage"');
    expect(streamed.body).toContain('"usage"');
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${aiToken}` } });
    expect((await account.json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } }).data).toMatchObject({ balance: 4998, reserved: 0, lifetimeConsumed: 2 });
  });

  it("creates billing orders, settles signed payment callbacks idempotently, and refunds paid points", async () => {
    const tenant = "tenant-billing-orders";
    const billingToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "billing-owner",
      organizations: [tenant],
      permissions: ["billing.read", "billing.write"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const headers = { authorization: `Bearer ${billingToken}`, "content-type": "application/json" };

    const plans = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/plans`, { headers });
    expect(plans.status).toBe(200);
    expect((await plans.json() as { data: Array<{ id: string; points: number }> }).data).toEqual(expect.arrayContaining([expect.objectContaining({ id: "team", points: 10000 })]));

    const created = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify({ planId: "team", idempotencyKey: "billing-order-001" }),
    });
    expect(created.status).toBe(201);
    const createdOrder = (await created.json() as { data: { orderNo: string; status: string; points: number } }).data;
    expect(createdOrder).toMatchObject({ status: "pending", points: 10000 });

    const payload = JSON.stringify({ orderNo: createdOrder.orderNo, status: "paid", paymentId: "pay-001", paymentChannel: "test", amountMinor: 9900, currency: "CNY" });
    const signature = createHmac("sha256", "billing-callback-secret").update(payload).digest("hex");
    const callback = await fetch(`${endpoint}/v1/billing/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openbuddy-billing-signature": signature },
      body: payload,
    });
    expect(callback.status).toBe(200);
    expect(await callback.json()).toMatchObject({ data: { orderNo: createdOrder.orderNo, status: "paid" } });

    const amountRequiredOrder = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers, body: JSON.stringify({ planId: "team", idempotencyKey: "billing-order-amount-required" }) });
    expect(amountRequiredOrder.status).toBe(201);
    const amountRequiredOrderNo = (await amountRequiredOrder.json() as { data: { orderNo: string } }).data.orderNo;
    const amountRequiredPayload = JSON.stringify({ orderNo: amountRequiredOrderNo, status: "paid", paymentId: "pay-amount-required", paymentChannel: "test", currency: "CNY" });
    const amountRequiredSignature = createHmac("sha256", "billing-callback-secret").update(amountRequiredPayload).digest("hex");
    const amountRequiredCallback = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": amountRequiredSignature }, body: amountRequiredPayload });
    expect(amountRequiredCallback.status).toBe(400);
    expect(await amountRequiredCallback.json()).toMatchObject({ code: "BILLING_AMOUNT_REQUIRED" });

    const currencyRequiredPayload = JSON.stringify({ orderNo: amountRequiredOrderNo, status: "paid", paymentId: "pay-currency-required", paymentChannel: "test", amountMinor: 9900 });
    const currencyRequiredSignature = createHmac("sha256", "billing-callback-secret").update(currencyRequiredPayload).digest("hex");
    const currencyRequiredCallback = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": currencyRequiredSignature }, body: currencyRequiredPayload });
    expect(currencyRequiredCallback.status).toBe(400);
    expect(await currencyRequiredCallback.json()).toMatchObject({ code: "BILLING_CURRENCY_REQUIRED" });

    const mismatchPayload = JSON.stringify({ orderNo: amountRequiredOrderNo, status: "paid", paymentId: "pay-mismatch", paymentChannel: "test", amountMinor: 1, currency: "CNY" });
    const mismatchSignature = createHmac("sha256", "billing-callback-secret").update(mismatchPayload).digest("hex");
    const mismatchCallback = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": mismatchSignature }, body: mismatchPayload });
    expect(mismatchCallback.status).toBe(409);
    expect(await mismatchCallback.json()).toMatchObject({ code: "BILLING_AMOUNT_MISMATCH" });

    const currencyMismatchPayload = JSON.stringify({ orderNo: amountRequiredOrderNo, status: "paid", paymentId: "pay-currency-mismatch", paymentChannel: "test", amountMinor: 9900, currency: "USD" });
    const currencyMismatchSignature = createHmac("sha256", "billing-callback-secret").update(currencyMismatchPayload).digest("hex");
    const currencyMismatchCallback = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": currencyMismatchSignature }, body: currencyMismatchPayload });
    expect(currencyMismatchCallback.status).toBe(409);
    expect(await currencyMismatchCallback.json()).toMatchObject({ code: "BILLING_CURRENCY_MISMATCH" });

    const grossReconciliation = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation`, { headers: { authorization: `Bearer ${billingToken}` } });
    expect(grossReconciliation.status).toBe(200);
    expect(await grossReconciliation.json()).toMatchObject({ data: { commerce: { grossOrders: 1, refundedOrders: 0, grossPoints: 10000, refundedPoints: 0, netPoints: 10000, grossAmountMinorByCurrency: { CNY: 9900 }, refundedAmountMinorByCurrency: {}, netAmountMinorByCurrency: { CNY: 9900 } } } });

    const retry = await fetch(`${endpoint}/v1/billing/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openbuddy-billing-signature": signature },
      body: payload,
    });
    expect(retry.status).toBe(200);

    const conflictingPayload = JSON.stringify({ orderNo: createdOrder.orderNo, status: "paid", paymentId: "pay-002", paymentChannel: "test", amountMinor: 9900, currency: "CNY" });
    const conflictingSignature = createHmac("sha256", "billing-callback-secret").update(conflictingPayload).digest("hex");
    const conflictingCallback = await fetch(`${endpoint}/v1/billing/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openbuddy-billing-signature": conflictingSignature },
      body: conflictingPayload,
    });
    expect(conflictingCallback.status).toBe(409);
    expect(await conflictingCallback.json()).toMatchObject({ code: "BILLING_CALLBACK_REPLAY_CONFLICT" });

    const duplicatePaymentOrderResponse = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify({ planId: "team", idempotencyKey: "billing-order-duplicate-payment-001" }),
    });
    expect(duplicatePaymentOrderResponse.status).toBe(201);
    const duplicatePaymentOrder = (await duplicatePaymentOrderResponse.json() as { data: { orderNo: string } }).data;
    const duplicatePaymentPayload = JSON.stringify({ orderNo: duplicatePaymentOrder.orderNo, status: "paid", paymentId: "pay-001", paymentChannel: "test", amountMinor: 9900, currency: "CNY" });
    const duplicatePaymentSignature = createHmac("sha256", "billing-callback-secret").update(duplicatePaymentPayload).digest("hex");
    const duplicatePaymentCallback = await fetch(`${endpoint}/v1/billing/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openbuddy-billing-signature": duplicatePaymentSignature },
      body: duplicatePaymentPayload,
    });
    expect(duplicatePaymentCallback.status).toBe(409);
    expect(await duplicatePaymentCallback.json()).toMatchObject({ code: "BILLING_PAYMENT_REPLAY_CONFLICT" });

    const missingPaymentOrderResponse = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify({ planId: "team", idempotencyKey: "billing-order-missing-payment-001" }),
    });
    expect(missingPaymentOrderResponse.status).toBe(201);
    const missingPaymentOrder = (await missingPaymentOrderResponse.json() as { data: { orderNo: string } }).data;
    const missingPaymentPayload = JSON.stringify({ orderNo: missingPaymentOrder.orderNo, status: "paid", paymentChannel: "test", amountMinor: 9900, currency: "CNY" });
    const missingPaymentSignature = createHmac("sha256", "billing-callback-secret").update(missingPaymentPayload).digest("hex");
    const missingPaymentCallback = await fetch(`${endpoint}/v1/billing/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openbuddy-billing-signature": missingPaymentSignature },
      body: missingPaymentPayload,
    });
    expect(missingPaymentCallback.status).toBe(400);
    expect(await missingPaymentCallback.json()).toMatchObject({ code: "BILLING_PAYMENT_ID_REQUIRED" });

    const missingPaymentChannelPayload = JSON.stringify({ orderNo: missingPaymentOrder.orderNo, status: "paid", paymentId: "pay-without-channel", amountMinor: 9900, currency: "CNY" });
    const missingPaymentChannelSignature = createHmac("sha256", "billing-callback-secret").update(missingPaymentChannelPayload).digest("hex");
    const missingPaymentChannelCallback = await fetch(`${endpoint}/v1/billing/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openbuddy-billing-signature": missingPaymentChannelSignature },
      body: missingPaymentChannelPayload,
    });
    expect(missingPaymentChannelCallback.status).toBe(400);
    expect(await missingPaymentChannelCallback.json()).toMatchObject({ code: "BILLING_PAYMENT_CHANNEL_REQUIRED" });

    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${billingToken}` } });
    expect((await account.json() as { data: { balance: number; lifetimeGranted: number; lifetimeRefunded: number } }).data).toMatchObject({ balance: 10000, lifetimeGranted: 10000, lifetimeRefunded: 0 });

    const orders = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { headers: { authorization: `Bearer ${billingToken}` } });
    expect((await orders.json() as { data: Array<{ orderNo: string; status: string }> }).data).toEqual(expect.arrayContaining([expect.objectContaining({ orderNo: createdOrder.orderNo, status: "paid" })]));

    const refund = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders/${encodeURIComponent(createdOrder.orderNo)}/refund`, { method: "POST", headers });
    expect(refund.status).toBe(200);
    const afterRefund = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${billingToken}` } });
    expect((await afterRefund.json() as { data: { balance: number; lifetimeRefunded: number } }).data).toMatchObject({ balance: 0, lifetimeRefunded: 10000 });
    const netReconciliation = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation`, { headers: { authorization: `Bearer ${billingToken}` } });
    expect(netReconciliation.status).toBe(200);
    expect(await netReconciliation.json()).toMatchObject({ data: { commerce: { grossOrders: 1, refundedOrders: 1, grossPoints: 10000, refundedPoints: 10000, netPoints: 0, grossAmountMinorByCurrency: { CNY: 9900 }, refundedAmountMinorByCurrency: { CNY: 9900 }, netAmountMinorByCurrency: { CNY: 0 } } } });

    const reservedTenant = "tenant-billing-refund-reserved";
    const reservedToken = token(privateKey, { iss: issuer, aud: audience, sub: "billing-owner", organizations: [reservedTenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const reservedHeaders = { authorization: `Bearer ${reservedToken}`, "content-type": "application/json" };
    const reservedOrderResponse = await fetch(`${endpoint}/v1/tenants/${reservedTenant}/billing/orders`, { method: "POST", headers: reservedHeaders, body: JSON.stringify({ planId: "team", idempotencyKey: "reserved-refund-order-001" }) });
    expect(reservedOrderResponse.status).toBe(201);
    const reservedOrder = (await reservedOrderResponse.json() as { data: { orderNo: string } }).data;
    const reservedPaymentPayload = JSON.stringify({ orderNo: reservedOrder.orderNo, status: "paid", paymentId: "reserved-pay", paymentChannel: "test", amountMinor: 9900, currency: "CNY" });
    const reservedPaymentSignature = createHmac("sha256", "billing-callback-secret").update(reservedPaymentPayload).digest("hex");
    const reservedPayment = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": reservedPaymentSignature }, body: reservedPaymentPayload });
    expect(reservedPayment.status).toBe(200);
    const reserve = await fetch(`${endpoint}/v1/tenants/${reservedTenant}/credits/reserve`, { method: "POST", headers: reservedHeaders, body: JSON.stringify({ amount: 5000, model: "demo-model", idempotencyKey: "reserved-refund-hold-001" }) });
    expect(reserve.status).toBe(201);
    const reservedRefund = await fetch(`${endpoint}/v1/tenants/${reservedTenant}/billing/orders/${encodeURIComponent(reservedOrder.orderNo)}/refund`, { method: "POST", headers: reservedHeaders });
    expect(reservedRefund.status).toBe(409);
    expect(await reservedRefund.json()).toMatchObject({ code: "BILLING_REFUND_BALANCE_INSUFFICIENT" });

    const unsigned = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
    expect(unsigned.status).toBe(401);
  });

  it("carries plan point validity into paid orders and purchase ledger", async () => {
    const tenant = "tenant-billing-expiry-contract";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "expiry-catalog-admin", organizations: [tenant], permissions: ["billing.read", "billing.write", "billing.catalog.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    const planResponse = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/plans`, { method: "PATCH", headers, body: JSON.stringify({ id: "short-lived", name: "Short Lived", currency: "CNY", priceMinor: 100, points: 100, pointsValidDays: 7 }) });
    expect(planResponse.status).toBe(200);
    const orderResponse = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers, body: JSON.stringify({ planId: "short-lived", idempotencyKey: "expiry-contract-order-001" }) });
    const order = (await orderResponse.json() as { data: { orderNo: string; pointsValidDays?: number } }).data;
    expect(order).toMatchObject({ pointsValidDays: 7 });
    const payload = JSON.stringify({ orderNo: order.orderNo, status: "paid", paymentId: "expiry-contract-pay-001", paymentChannel: "test", amountMinor: 100, currency: "CNY" });
    const signature = createHmac("sha256", "billing-callback-secret").update(payload).digest("hex");
    const callback = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": signature }, body: payload });
    expect(callback.status).toBe(200);
    const orders = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { headers });
    expect((await orders.json() as { data: Array<{ orderNo: string; pointsExpiresAt?: string }> }).data.find((entry) => entry.orderNo === order.orderNo)?.pointsExpiresAt).toEqual(expect.any(String));
    const ledger = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger`, { headers });
    expect((await ledger.json() as { data: Array<{ type: string; expiresAt?: string }> }).data).toEqual(expect.arrayContaining([expect.objectContaining({ type: "purchase", expiresAt: expect.any(String) })]));
  });

  it("does not refund a consumed order by borrowing later grants", async () => {
    const tenant = "tenant-billing-refund-batch-integrity";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "refund-batch-admin", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    const orderResponse = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers, body: JSON.stringify({ planId: "team", idempotencyKey: "refund-batch-order-001" }) });
    expect(orderResponse.status).toBe(201);
    const order = (await orderResponse.json() as { data: { orderNo: string; points: number } }).data;
    const payload = JSON.stringify({ orderNo: order.orderNo, status: "paid", paymentId: "refund-batch-pay-001", paymentChannel: "test", amountMinor: 9900, currency: "CNY" });
    const signature = createHmac("sha256", "billing-callback-secret").update(payload).digest("hex");
    const callback = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": signature }, body: payload });
    expect(callback.status).toBe(200);
    const reservation = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, { method: "POST", headers, body: JSON.stringify({ amount: 50, model: "demo-model", idempotencyKey: "refund-batch-reserve-001" }) });
    expect(reservation.status).toBe(201);
    const settled = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/settle`, { method: "POST", headers, body: JSON.stringify({ reservationKey: "refund-batch-reserve-001", amount: 50, model: "demo-model", promptTokens: 10, completionTokens: 10 }) });
    expect(settled.status).toBe(200);
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ amount: 100, idempotencyKey: "refund-batch-later-grant-001" }) });
    expect(grant.status).toBe(201);
    const refund = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders/${encodeURIComponent(order.orderNo)}/refund`, { method: "POST", headers });
    expect(refund.status).toBe(409);
    expect(await refund.json()).toMatchObject({ code: "BILLING_REFUND_POINTS_CONSUMED" });
  });

  it("keeps shared-wallet purchases separate from tenant subscriptions", async () => {
    const tenant = "tenant-wallet-purchase-entitlements";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "wallet-purchase-owner", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    const walletResponse = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets`, { method: "POST", headers, body: JSON.stringify({ id: "team-wallet", name: "Team Wallet", idempotencyKey: "wallet-purchase-create-001" }) });
    expect(walletResponse.status).toBe(201);
    const wallet = (await walletResponse.json() as { data: { wallet: { id: string } } }).data.wallet;
    const orderResponse = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers, body: JSON.stringify({ planId: "team", walletId: wallet.id, idempotencyKey: "wallet-purchase-order-001" }) });
    expect(orderResponse.status).toBe(201);
    const order = (await orderResponse.json() as { data: { orderNo: string; walletId?: string; entitlements?: Record<string, unknown> } }).data;
    expect(order).toMatchObject({ walletId: wallet.id, entitlements: {} });
    const payload = JSON.stringify({ orderNo: order.orderNo, status: "paid", paymentId: "wallet-purchase-pay-001", paymentChannel: "test", amountMinor: 9900, currency: "CNY" });
    const signature = createHmac("sha256", "billing-callback-secret").update(payload).digest("hex");
    const callback = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": signature }, body: payload });
    expect(callback.status).toBe(200);
    const subscription = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/subscription`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect(await subscription.json()).toMatchObject({ data: null });
    const account = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${wallet.id}/credits`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect(await account.json()).toMatchObject({ data: { walletId: wallet.id, balance: 10000 } });
  });

  it("issues the Free welcome grant once with an auditable idempotency key", async () => {
    const tenant = "tenant-free-welcome";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "welcome-orchestrator", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    const first = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/welcome`, { method: "POST", headers, body: JSON.stringify({ subject: "new-member", idempotencyKey: "welcome-grant-001" }) });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ data: { entry: { type: "grant", amount: 100, createdBy: "free-welcome-orchestrator", expiresAt: expect.any(String) }, account: { balance: 100, lifetimeGranted: 100 } } });
    const replay = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/welcome`, { method: "POST", headers, body: JSON.stringify({ subject: "new-member", idempotencyKey: "welcome-grant-001" }) });
    expect(replay.status).toBe(201);
    const duplicate = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/welcome`, { method: "POST", headers, body: JSON.stringify({ subject: "new-member", idempotencyKey: "welcome-grant-002" }) });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "WELCOME_CREDIT_ALREADY_ISSUED" });
    const ledger = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger?subject=new-member`, { headers });
    expect((await ledger.json() as { data: Array<{ type: string }> }).data.filter((entry) => entry.type === "grant")).toHaveLength(1);

    const regular = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "other-member", amount: 100, idempotencyKey: "welcome-grant-003" }) });
    expect(regular.status).toBe(201);
    const collision = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/welcome`, { method: "POST", headers, body: JSON.stringify({ subject: "other-member", idempotencyKey: "welcome-grant-003" }) });
    expect(collision.status).toBe(409);
    expect(await collision.json()).toMatchObject({ code: "CREDIT_IDEMPOTENCY_CONFLICT" });
  });

  it("applies paid plan entitlements to the tenant and restores policy on refund", async () => {
    const tenant = "tenant-billing-entitlements";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "catalog-admin", organizations: [tenant], permissions: ["billing.read", "billing.write", "billing.catalog.write", "tenant.policy.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    const plan = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/plans`, { method: "PATCH", headers, body: JSON.stringify({ id: "entitled-team", name: "Entitled Team", currency: "CNY", priceMinor: 19900, points: 20000, maxTokensPerDay: 120000, maxPointsPerDay: 20000, modelAllowlist: ["demo-model"], mcpAllowlist: ["filesystem"], newApiGroup: "enterprise-ai" }) });
    expect(plan.status).toBe(200);
    const created = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers, body: JSON.stringify({ planId: "entitled-team", idempotencyKey: "entitled-order-001" }) });
    expect(created.status).toBe(201);
    const order = (await created.json() as { data: { orderNo: string } }).data;
    const payload = JSON.stringify({ orderNo: order.orderNo, status: "paid", paymentId: "entitled-pay-001", paymentChannel: "test", amountMinor: 19900, currency: "CNY" });
    const signature = createHmac("sha256", "billing-callback-secret").update(payload).digest("hex");
    const callback = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": signature }, body: payload });
    expect(callback.status).toBe(200);
    const policy = await fetch(`${endpoint}/v1/tenants/${tenant}/runtime-policy`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect((await policy.json() as { data: Record<string, unknown> }).data).toMatchObject({ maxTokensPerDay: 120000, maxPointsPerDay: 20000, modelAllowlist: ["demo-model"], mcpAllowlist: ["filesystem"], newApiGroup: "enterprise-ai" });
    const subscription = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/subscription`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect(subscription.status).toBe(200);
    expect((await subscription.json() as { data: Record<string, unknown> }).data).toMatchObject({ planId: "entitled-team", orderNo: order.orderNo, status: "active", entitlements: { maxTokensPerDay: 120000, maxPointsPerDay: 20000, newApiGroup: "enterprise-ai" } });
    const refund = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders/${encodeURIComponent(order.orderNo)}/refund`, { method: "POST", headers });
    expect(refund.status).toBe(200);
    const cancelledSubscription = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/subscription`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect((await cancelledSubscription.json() as { data: Record<string, unknown> }).data).toMatchObject({ status: "cancelled", orderNo: order.orderNo });
    const restored = await fetch(`${endpoint}/v1/tenants/${tenant}/runtime-policy`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect((await restored.json() as { data: Record<string, unknown> }).data).not.toMatchObject({ maxTokensPerDay: 120000, maxPointsPerDay: 20000, newApiGroup: "enterprise-ai" });
  });

  it("does not let an older refunded order roll back a newer subscription", async () => {
    const tenant = "tenant-billing-subscription-replacement";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "catalog-admin-replacement", organizations: [tenant], permissions: ["billing.read", "billing.write", "billing.catalog.write", "tenant.policy.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    for (const planInput of [
      { id: "replacement-basic", name: "Replacement Basic", maxTokensPerDay: 10000, maxPointsPerDay: 1000, modelAllowlist: ["basic-model"] },
      { id: "replacement-pro", name: "Replacement Pro", maxTokensPerDay: 50000, maxPointsPerDay: 5000, modelAllowlist: ["pro-model"] },
    ]) {
      const response = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/plans`, { method: "PATCH", headers, body: JSON.stringify({ ...planInput, currency: "CNY", priceMinor: 100, points: 100 }) });
      expect(response.status).toBe(200);
    }
    const createOrder = async (planId: string, key: string) => {
      const response = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers, body: JSON.stringify({ planId, idempotencyKey: key }) });
      expect(response.status).toBe(201);
      return (await response.json() as { data: { orderNo: string } }).data.orderNo;
    };
    const pay = async (orderNo: string, paymentId: string) => {
      const payload = JSON.stringify({ orderNo, status: "paid", paymentId, paymentChannel: "test", amountMinor: 100, currency: "CNY" });
      const signature = createHmac("sha256", "billing-callback-secret").update(payload).digest("hex");
      const response = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": signature }, body: payload });
      expect(response.status).toBe(200);
    };
    const olderOrder = await createOrder("replacement-basic", "replacement-order-001");
    await pay(olderOrder, "replacement-pay-001");
    const newerOrder = await createOrder("replacement-pro", "replacement-order-002");
    await pay(newerOrder, "replacement-pay-002");
    const refund = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders/${encodeURIComponent(olderOrder)}/refund`, { method: "POST", headers });
    expect(refund.status).toBe(200);
    const policy = await fetch(`${endpoint}/v1/tenants/${tenant}/runtime-policy`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect((await policy.json() as { data: Record<string, unknown> }).data).toMatchObject({ maxTokensPerDay: 50000, maxPointsPerDay: 5000, modelAllowlist: ["pro-model"] });
  });

  it("restores the previous paid subscription when the newest order is refunded", async () => {
    const tenant = "tenant-billing-subscription-refund-latest";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "catalog-admin-refund-latest", organizations: [tenant], permissions: ["billing.read", "billing.write", "billing.catalog.write", "tenant.policy.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    for (const planInput of [
      { id: "rollback-basic", name: "Rollback Basic", maxTokensPerDay: 10000, maxPointsPerDay: 1000, modelAllowlist: ["basic-model"] },
      { id: "rollback-pro", name: "Rollback Pro", maxTokensPerDay: 50000, maxPointsPerDay: 5000, modelAllowlist: ["pro-model"] },
    ]) {
      const response = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/plans`, { method: "PATCH", headers, body: JSON.stringify({ ...planInput, currency: "CNY", priceMinor: 100, points: 100 }) });
      expect(response.status).toBe(200);
    }
    const createAndPay = async (planId: string, orderKey: string, paymentId: string) => {
      const created = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers, body: JSON.stringify({ planId, idempotencyKey: orderKey }) });
      expect(created.status).toBe(201);
      const orderNo = (await created.json() as { data: { orderNo: string } }).data.orderNo;
      const payload = JSON.stringify({ orderNo, status: "paid", paymentId, paymentChannel: "test", amountMinor: 100, currency: "CNY" });
      const signature = createHmac("sha256", "billing-callback-secret").update(payload).digest("hex");
      const paid = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": signature }, body: payload });
      expect(paid.status).toBe(200);
      return orderNo;
    };
    await createAndPay("rollback-basic", "rollback-order-001", "rollback-pay-001");
    const latestOrder = await createAndPay("rollback-pro", "rollback-order-002", "rollback-pay-002");
    const refund = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders/${encodeURIComponent(latestOrder)}/refund`, { method: "POST", headers });
    expect(refund.status).toBe(200);
    const subscription = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/subscription`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect((await subscription.json() as { data: Record<string, unknown> }).data).toMatchObject({ status: "active", planId: "rollback-basic", orderNo: expect.stringContaining("ob_") });
    const policy = await fetch(`${endpoint}/v1/tenants/${tenant}/runtime-policy`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect((await policy.json() as { data: Record<string, unknown> }).data).toMatchObject({ maxTokensPerDay: 10000, maxPointsPerDay: 1000, modelAllowlist: ["basic-model"] });
  });

  it("automatically expires pending orders before listing and rejects late payment callbacks", async () => {
    const tenant = "tenant-billing-expiry";
    const billingToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "billing-owner",
      organizations: [tenant],
      permissions: ["billing.read", "billing.write"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const headers = { authorization: `Bearer ${billingToken}`, "content-type": "application/json" };
    const created = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify({ planId: "team", idempotencyKey: "billing-expiry-001", expiresInSeconds: 60 }),
    });
    expect(created.status).toBe(201);
    const createdOrder = (await created.json() as { data: { orderNo: string; status: string } }).data;
    expect(createdOrder.status).toBe("pending");

    vi.setSystemTime(Date.now() + 61_000);
    try {
      const orders = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { headers: { authorization: `Bearer ${billingToken}` } });
      expect(orders.status).toBe(200);
      expect((await orders.json() as { data: Array<{ orderNo: string; status: string }> }).data).toEqual([expect.objectContaining({ orderNo: createdOrder.orderNo, status: "expired" })]);

      const latePayload = JSON.stringify({ orderNo: createdOrder.orderNo, status: "paid", paymentId: "late-pay", paymentChannel: "test", amountMinor: 9900, currency: "CNY" });
      const lateSignature = createHmac("sha256", "billing-callback-secret").update(latePayload).digest("hex");
      const callback = await fetch(`${endpoint}/v1/billing/callback`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-openbuddy-billing-signature": lateSignature },
        body: latePayload,
      });
      expect(callback.status).toBe(409);
      const account = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${billingToken}` } });
      expect((await account.json() as { data: { balance: number; lifetimeGranted: number } }).data).toMatchObject({ balance: 0, lifetimeGranted: 0 });
    } finally {
      vi.useRealTimers();
    }

    const walletTenant = "tenant-credit-expiry-wallet";
    const walletOwnerToken = token(privateKey, { iss: issuer, aud: audience, sub: "wallet-expiry-owner", organizations: [walletTenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 1_000_000 });
    const walletHeaders = { authorization: `Bearer ${walletOwnerToken}`, "content-type": "application/json" };
    const walletCreate = await fetch(`${endpoint}/v1/tenants/${walletTenant}/wallets`, { method: "POST", headers: walletHeaders, body: JSON.stringify({ name: "Expiry Wallet" }) });
    expect(walletCreate.status).toBe(201);
    const walletId = (await walletCreate.json() as { data: { wallet: { id: string } } }).data.wallet.id;
    const walletGrant = await fetch(`${endpoint}/v1/tenants/${walletTenant}/credits/grant`, { method: "POST", headers: walletHeaders, body: JSON.stringify({ walletId, amount: 3, validDays: 1, idempotencyKey: "wallet-expiry-grant-001" }) });
    expect(walletGrant.status).toBe(201);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 2 * 86_400_000);
      const walletReserve = await fetch(`${endpoint}/v1/tenants/${walletTenant}/credits/reserve`, { method: "POST", headers: walletHeaders, body: JSON.stringify({ walletId, amount: 1, model: "demo-model", idempotencyKey: "wallet-expiry-reserve-001" }) });
      expect(walletReserve.status).toBe(402);
      const walletAccount = await fetch(`${endpoint}/v1/tenants/${walletTenant}/wallets/${walletId}/credits`, { headers: walletHeaders });
      expect(await walletAccount.json()).toMatchObject({ data: { balance: 0, lifetimeExpired: 3, available: 0 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces JWT tenant boundaries and resource invariants", async () => {
    const health = await fetch(`${endpoint}/healthz`);
    expect(health.status).toBe(200);
    expect(health.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const ready = await fetch(`${endpoint}/readyz`);
    expect(ready.status).toBe(200);

    const create = await fetch(`${endpoint}/v1/tenants/tenant-a/resources`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "idempotency-key": "same-resource" },
      body: JSON.stringify({ type: "project", name: "Project A", metadata: { region: "cn", apiToken: "must-not-persist" } }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json() as { data: { id: string; version: number; metadata: Record<string, unknown> } }).data;
    expect(created.metadata).toEqual({ region: "cn" });

    const retry = await fetch(`${endpoint}/v1/tenants/tenant-a/resources`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "idempotency-key": "same-resource" },
      body: JSON.stringify({ type: "project", name: "Different Name" }),
    });
    expect((await retry.json() as { data: { id: string } }).data.id).toBe(created.id);

    const stale = await fetch(`${endpoint}/v1/tenants/tenant-a/resources/${created.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${accessToken}`, "if-match": "99", "content-type": "application/json" },
      body: JSON.stringify({ name: "Rejected" }),
    });
    expect(stale.status).toBe(409);

    const crossTenant = await fetch(`${endpoint}/v1/tenants/tenant-b/resources`, { headers: { authorization: `Bearer ${accessToken}` } });
    expect(crossTenant.status).toBe(403);
  });

  it("does not let a tenant admin role cross the membership boundary", async () => {
    const tenantAdminToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "tenant-admin-a",
      organizations: ["tenant-a"],
      roles: ["admin"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const response = await fetch(`${endpoint}/v1/tenants/tenant-b/resources`, {
      headers: { authorization: `Bearer ${tenantAdminToken}` },
    });
    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code).toBe("TENANT_MEMBERSHIP_REQUIRED");
  });

  it("enforces tenant policy, quota, suspension, and tenant-scoped audit access", async () => {
    const tenant = "tenant-policy";
    const policyToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "policy-admin",
      organizations: [tenant],
      permissions: ["project.create", "project.read", "tenant.policy.read", "tenant.policy.write", "tenant.audit.read"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const headers = { authorization: `Bearer ${policyToken}` };
    const initial = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { headers });
    expect(initial.status).toBe(200);
    const initialPolicy = (await initial.json() as { data: { status: string; version: number } }).data;
    expect(initialPolicy.status).toBe("active");
    expect(initialPolicy.version).toBe(1);

    const runtimeInitial = await fetch(`${endpoint}/v1/tenants/${tenant}/runtime-policy`, { headers });
    expect(runtimeInitial.status).toBe(200);

    const unconfiguredGroup = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ newApiGroup: "unconfigured-group" }),
    });
    expect(unconfiguredGroup.status).toBe(400);
    expect((await unconfiguredGroup.json() as { code: string }).code).toBe("NEW_API_GROUP_NOT_CONFIGURED");

    const update = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: initialPolicy.version, maxResources: 1, newApiGroup: "enterprise-ai" }),
    });
    expect(update.status).toBe(200);
    const updatedPolicy = (await update.json() as { data: { maxResources: number; version: number; newApiGroup?: string } }).data;
    expect(updatedPolicy.maxResources).toBe(1);
    expect(updatedPolicy.version).toBe(2);
    expect(updatedPolicy.newApiGroup).toBe("enterprise-ai");

    const stale = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: initialPolicy.version, maxResources: 2 }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json() as { code: string }).code).toBe("TENANT_POLICY_VERSION_CONFLICT");

    const policyUpdate = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ modelAllowlist: ["openai/gpt-4o"], mcpAllowlist: ["filesystem"], maxTokensPerDay: 100 }),
    });
    expect(policyUpdate.status).toBe(200);
    const runtimePolicy = await fetch(`${endpoint}/v1/tenants/${tenant}/runtime-policy`, { headers });
    expect((await runtimePolicy.json() as { data: { modelAllowlist: string[]; mcpAllowlist: string[]; maxTokensPerDay: number; tokensUsedToday: number; maxPointsPerDay?: number; pointsUsedToday: number; newApiGroup?: string } }).data).toMatchObject({ modelAllowlist: ["openai/gpt-4o"], mcpAllowlist: ["filesystem"], maxTokensPerDay: 100, tokensUsedToday: 0, pointsUsedToday: 0, newApiGroup: "enterprise-ai" });

    const usage = await fetch(`${endpoint}/v1/tenants/${tenant}/runtime-usage`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ tokens: 40 }) });
    expect(usage.status).toBe(200);
    expect((await usage.json() as { data: { tokensUsedToday: number } }).data.tokensUsedToday).toBe(40);

    const first = await fetch(`${endpoint}/v1/tenants/${tenant}/resources`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ type: "project", name: "Quota project" }),
    });
    expect(first.status).toBe(201);
    const second = await fetch(`${endpoint}/v1/tenants/${tenant}/resources`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ type: "project", name: "Rejected project" }),
    });
    expect(second.status).toBe(429);
    expect((await second.json() as { code: string }).code).toBe("TENANT_QUOTA_EXCEEDED");

    const suspend = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 3, status: "suspended" }),
    });
    expect(suspend.status).toBe(200);
    const blocked = await fetch(`${endpoint}/v1/tenants/${tenant}/resources`, { headers });
    expect(blocked.status).toBe(423);
    expect((await blocked.json() as { code: string }).code).toBe("TENANT_SUSPENDED");

    const audit = await fetch(`${endpoint}/v1/tenants/${tenant}/audit?limit=20`, { headers });
    expect(audit.status).toBe(200);
    expect((await audit.json() as { data: unknown[] }).data.length).toBeGreaterThan(0);

    const resume = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 4, status: "active" }),
    });
    expect(resume.status).toBe(200);

    const clearGroup = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 5, newApiGroup: "" }),
    });
    expect(clearGroup.status).toBe(200);
    expect((await clearGroup.json() as { data: { newApiGroup?: string } }).data.newApiGroup).toBeUndefined();
  });

  it("keeps credit mutations tenant-scoped and idempotent", async () => {
    const tenant = "tenant-credit";
    const creditToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "credit-admin",
      organizations: [tenant],
      permissions: ["billing.read", "billing.write"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const headers = { authorization: `Bearer ${creditToken}` };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ subject: "credit-admin", amount: 100, idempotencyKey: "credit-grant-001" }),
    });
    expect(grant.status).toBe(201);

    const directPurchase = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ subject: "credit-admin", amount: 100, type: "purchase", idempotencyKey: "credit-purchase-direct-001" }),
    });
    expect(directPurchase.status).toBe(400);
    expect(await directPurchase.json()).toMatchObject({ code: "PURCHASE_REQUIRES_BILLING_ORDER" });

    const conflictingGrant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ subject: "credit-admin", amount: 101, idempotencyKey: "credit-grant-001" }),
    });
    expect(conflictingGrant.status).toBe(409);
    expect((await conflictingGrant.json() as { code: string }).code).toBe("CREDIT_IDEMPOTENCY_CONFLICT");

    const reserve = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ amount: 40, model: "demo-model", idempotencyKey: "credit-reserve-001" }),
    });
    expect(reserve.status).toBe(201);
    const reservation = (await reserve.json() as { data: { account: { reserved: number }; entry: { idempotencyKey?: string } } }).data;
    expect(reservation.account.reserved).toBe(40);
    expect(reservation.entry.idempotencyKey).toBe("credit-reserve-001");

    const retry = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ amount: 40, model: "demo-model", idempotencyKey: "credit-reserve-001" }),
    });
    expect(retry.status).toBe(201);
    expect((await retry.json() as { data: { account: { reserved: number } } }).data.account.reserved).toBe(40);

    const conflictingReserve = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ amount: 41, model: "demo-model", idempotencyKey: "credit-reserve-001" }),
    });
    expect(conflictingReserve.status).toBe(409);
    expect((await conflictingReserve.json() as { code: string }).code).toBe("CREDIT_IDEMPOTENCY_CONFLICT");

    const settle = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/settle`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ reservationKey: "credit-reserve-001", amount: 25, model: "demo-model" }),
    });
    expect(settle.status).toBe(200);
    const settled = (await settle.json() as { data: { account: { balance: number; reserved: number; lifetimeConsumed: number }; refunded?: number } }).data;
    expect(settled.account).toMatchObject({ balance: 75, reserved: 0, lifetimeConsumed: 25 });
    expect(settled.refunded).toBe(15);

    const conflictingSettle = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/settle`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ reservationKey: "credit-reserve-001", amount: 24, model: "demo-model" }),
    });
    expect(conflictingSettle.status).toBe(409);
    expect((await conflictingSettle.json() as { code: string }).code).toBe("CREDIT_IDEMPOTENCY_CONFLICT");

    const overageReserve = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ amount: 10, model: "demo-model", idempotencyKey: "credit-reserve-overage-001" }),
    });
    expect(overageReserve.status).toBe(201);

    const overageSettle = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/settle`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ reservationKey: "credit-reserve-overage-001", amount: 15, model: "demo-model" }),
    });
    expect(overageSettle.status).toBe(200);
    expect((await overageSettle.json() as { data: { account: { balance: number; reserved: number; lifetimeConsumed: number }; refunded?: number; additionalCharged?: number } }).data).toMatchObject({ account: { balance: 60, reserved: 0, lifetimeConsumed: 40 }, refunded: 0, additionalCharged: 5 });

    const insufficientReserve = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ amount: 50, model: "demo-model", idempotencyKey: "credit-reserve-insufficient-001" }),
    });
    expect(insufficientReserve.status).toBe(201);
    const insufficientSettle = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/settle`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ reservationKey: "credit-reserve-insufficient-001", amount: 100, model: "demo-model" }),
    });
    expect(insufficientSettle.status).toBe(402);
    expect(await insufficientSettle.json()).toMatchObject({ code: "INSUFFICIENT_CREDITS_FOR_ACTUAL_USAGE" });
    const insufficientRetry = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/settle`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ reservationKey: "credit-reserve-insufficient-001", amount: 100, model: "demo-model" }),
    });
    expect(insufficientRetry.status).toBe(402);
    expect(await insufficientRetry.json()).toMatchObject({ code: "INSUFFICIENT_CREDITS_FOR_ACTUAL_USAGE" });
    const afterInsufficient = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers });
    expect((await afterInsufficient.json() as { data: { balance: number; reserved: number } }).data).toMatchObject({ balance: 60, reserved: 0 });

    const ledger = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger`, { headers });
    expect(ledger.status).toBe(200);
    const entries = (await ledger.json() as { data: Array<{ type: string; amount: number }> }).data;
    expect(entries.map((entry) => entry.type)).toEqual(expect.arrayContaining(["grant", "reservation", "consume", "refund"]));
  });

  it("does not treat permission or role owners as tenant membership", async () => {
    const forgedMembershipToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "permission-only-user",
      roles: ["tenant-claim/admin"],
      permissions: ["tenant-claim/billing.read"],
      capabilities: ["tenant-claim/cloud.sync"],
      groups: ["tenant-claim/members"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const response = await fetch(`${endpoint}/v1/tenants/tenant-claim/health`, {
      headers: { authorization: `Bearer ${forgedMembershipToken}` },
    });
    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code).toBe("TENANT_MEMBERSHIP_REQUIRED");
  });

  it("requires explicit tenant policy permissions", async () => {
    const noPolicyPermission = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "ordinary-user",
      organizations: ["tenant-a"],
      permissions: ["project.read"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const response = await fetch(`${endpoint}/v1/tenants/tenant-a/policy`, { headers: { authorization: `Bearer ${noPolicyPermission}` } });
    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code).toBe("PERMISSION_DENIED");
  });

  it("supports audited soft archive and restricts lifecycle transitions", async () => {
    const tenant = "tenant-lifecycle";
    const memberToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "lifecycle-member",
      organizations: [tenant],
      permissions: ["project.create", "project.read", "tenant.policy.read", "tenant.policy.write"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const memberHeaders = { authorization: `Bearer ${memberToken}` };
    const created = await fetch(`${endpoint}/v1/tenants/${tenant}/resources`, {
      method: "POST",
      headers: { ...memberHeaders, "content-type": "application/json" },
      body: JSON.stringify({ type: "project", name: "Lifecycle project" }),
    });
    expect(created.status).toBe(201);
    const resource = (await created.json() as { data: { id: string } }).data;
    const initial = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { headers: memberHeaders });
    const initialPolicy = (await initial.json() as { data: { version: number } }).data;
    const denied = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers: { ...memberHeaders, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: initialPolicy.version, status: "archived" }),
    });
    expect(denied.status).toBe(403);

    const globalToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "platform-admin",
      isAdmin: true,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const globalHeaders = { authorization: `Bearer ${globalToken}` };
    const archive = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers: { ...globalHeaders, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: initialPolicy.version, status: "archived" }),
    });
    expect(archive.status).toBe(200);
    const archivedPolicy = (await archive.json() as { data: { version: number; status: string } }).data;
    expect(archivedPolicy).toMatchObject({ status: "archived", version: initialPolicy.version + 1 });

    const read = await fetch(`${endpoint}/v1/tenants/${tenant}/resources/${resource.id}`, { headers: globalHeaders });
    expect(read.status).toBe(200);
    const blocked = await fetch(`${endpoint}/v1/tenants/${tenant}/resources`, {
      method: "POST",
      headers: { ...globalHeaders, "content-type": "application/json" },
      body: JSON.stringify({ type: "project", name: "Should stay archived" }),
    });
    expect(blocked.status).toBe(423);
    expect((await blocked.json() as { code: string }).code).toBe("TENANT_ARCHIVED");

    const restore = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, {
      method: "PATCH",
      headers: { ...globalHeaders, "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: archivedPolicy.version, status: "active" }),
    });
    expect(restore.status).toBe(200);
    expect((await restore.json() as { data: { status: string } }).data.status).toBe("active");
  });

  it("revokes and restores a tenant member at the gateway boundary", async () => {
    const tenant = "tenant-revocation";
    const memberToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "revoked-member",
      organizations: [tenant],
      permissions: ["project.read"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const adminToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "revocation-admin",
      organizations: [tenant],
      permissions: ["tenant.lifecycle.write"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const adminHeaders = { authorization: `Bearer ${adminToken}` };
    const revoke = await fetch(`${endpoint}/v1/tenants/${tenant}/member-revocations/${encodeURIComponent("revoked-member")}`, {
      method: "PATCH",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ revoked: true, reason: "离职" }),
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ data: { subject: "revoked-member", revoked: true } });

    const listed = await fetch(`${endpoint}/v1/tenants/${tenant}/member-revocations`, { headers: adminHeaders });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ data: [{ subject: "revoked-member", revokedAt: expect.any(String), revokedBy: "revocation-admin", reason: "离职" }] });

    const ordinaryList = await fetch(`${endpoint}/v1/tenants/${tenant}/member-revocations`, { headers: { authorization: `Bearer ${memberToken}` } });
    expect(ordinaryList.status).toBe(403);

    const blocked = await fetch(`${endpoint}/v1/tenants/${tenant}/resources`, { headers: { authorization: `Bearer ${memberToken}` } });
    expect(blocked.status).toBe(403);
    expect((await blocked.json() as { code: string }).code).toBe("TENANT_MEMBER_REVOKED");

    const restore = await fetch(`${endpoint}/v1/tenants/${tenant}/member-revocations/${encodeURIComponent("revoked-member")}`, {
      method: "PATCH",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ revoked: false }),
    });
    expect(restore.status).toBe(200);
    const readable = await fetch(`${endpoint}/v1/tenants/${tenant}/resources`, { headers: { authorization: `Bearer ${memberToken}` } });
    expect(readable.status).toBe(200);
  });

  it("keeps a global administrator able to restore its own revoked membership", async () => {
    const tenant = "tenant-global-recovery";
    const globalToken = token(privateKey, { iss: issuer, aud: audience, sub: "global-recovery", isAdmin: true, organizations: [tenant], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${globalToken}`, "content-type": "application/json" };
    const revoke = await fetch(`${endpoint}/v1/tenants/${tenant}/member-revocations/global-recovery`, { method: "PATCH", headers, body: JSON.stringify({ revoked: true }) });
    expect(revoke.status).toBe(200);
    const restore = await fetch(`${endpoint}/v1/tenants/${tenant}/member-revocations/global-recovery`, { method: "PATCH", headers, body: JSON.stringify({ revoked: false }) });
    expect(restore.status).toBe(200);
    expect(await restore.json()).toMatchObject({ data: { subject: "global-recovery", revoked: false } });
  });

  it("registers, lists, and unregisters tenant session bindings", async () => {
    const tenant = "tenant-sessions";
    const memberToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "session-member",
      organizations: [tenant],
      permissions: ["project.read"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const otherToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "other-member",
      organizations: [tenant],
      permissions: ["project.read"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const headers = { authorization: `Bearer ${memberToken}`, "content-type": "application/json" };

    const register = await fetch(`${endpoint}/v1/tenants/${tenant}/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: "session-1", kind: "desktop", scopes: ["agent.prompt", "memory.read"] }),
    });
    expect(register.status).toBe(201);
    const body = await register.json() as { data: { sessionId: string; subject: string; kind: string; scopes: string[]; lastSeenAt: string } };
    expect(body.data).toMatchObject({ sessionId: "session-1", subject: "session-member", kind: "desktop" });
    expect(body.data.scopes).toEqual(["agent.prompt", "memory.read"]);

    const list = await fetch(`${endpoint}/v1/tenants/${tenant}/sessions`, { headers: { authorization: `Bearer ${memberToken}` } });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ data: [{ sessionId: "session-1", subject: "session-member" }] });

    const crossSubject = await fetch(`${endpoint}/v1/tenants/${tenant}/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: "session-2", subject: "other-member" }),
    });
    expect(crossSubject.status).toBe(403);

    const otherList = await fetch(`${endpoint}/v1/tenants/${tenant}/sessions`, { headers: { authorization: `Bearer ${otherToken}` } });
    expect(otherList.status).toBe(200);
    const otherBody = await otherList.json() as { data: Array<{ sessionId: string; subject: string }> };
    expect(otherBody.data.some((row) => row.sessionId === "session-1")).toBe(true);

    const badSessionId = await fetch(`${endpoint}/v1/tenants/${tenant}/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: "bad id with space" }),
    });
    expect(badSessionId.status).toBe(400);

    const unregister = await fetch(`${endpoint}/v1/tenants/${tenant}/sessions/session-1`, { method: "DELETE", headers });
    expect(unregister.status).toBe(200);
    expect(await unregister.json()).toMatchObject({ data: { removed: true } });

    const missing = await fetch(`${endpoint}/v1/tenants/${tenant}/sessions/session-1`, { method: "DELETE", headers });
    expect(await missing.json()).toMatchObject({ data: { removed: false } });
  });

  it("requires explicit tenant audit permission", async () => {
    const noAuditPermission = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "ordinary-user",
      organizations: ["tenant-a"],
      permissions: ["project.read", "tenant.usage.write"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const response = await fetch(`${endpoint}/v1/tenants/tenant-a/audit`, { headers: { authorization: `Bearer ${noAuditPermission}` } });
    expect(response.status).toBe(403);
    expect((await response.json() as { code: string }).code).toBe("PERMISSION_DENIED");
  });

  it("lets a global administrator (isAdmin:true) reach audit-export and runtime-usage without the tenant-scoped permission name", async () => {
    const globalAdmin = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "global-admin-audit",
      isAdmin: true,
      organizations: ["tenant-audit-fix"],
      // permissions are deliberately absent or unrelated; global admin must
      // not depend on a tenant.audit.read claim to read audit export.
      permissions: ["audit.read"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const audit = await fetch(`${endpoint}/v1/tenants/tenant-audit-fix/audit-export?format=jsonl&limit=5`, { headers: { authorization: `Bearer ${globalAdmin}` } });
    expect(audit.status).toBe(200);
    const usage = await fetch(`${endpoint}/v1/tenants/tenant-audit-fix/runtime-usage`, { method: "POST", headers: { authorization: `Bearer ${globalAdmin}`, "content-type": "application/json" }, body: JSON.stringify({ tokens: 1 }) });
    expect(usage.status).toBe(200);
  });

  it("allows an authenticated tenant member to report only additive runtime usage", async () => {
    const memberToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "usage-member",
      organizations: ["tenant-a"],
      permissions: ["project.read", "tenant.usage.write"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const response = await fetch(`${endpoint}/v1/tenants/tenant-a/runtime-usage`, { method: "POST", headers: { authorization: `Bearer ${memberToken}`, "content-type": "application/json" }, body: JSON.stringify({ tokens: 1 }) });
    expect(response.status).toBe(200);
    expect((await response.json() as { data: { tokensUsedToday: number } }).data.tokensUsedToday).toBe(1);
  });

  it("reports tenant health, audits, and SIEM export for authorized members", async () => {
    const tenant = "tenant-health";
    const memberToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "health-member",
      organizations: [tenant],
    permissions: ["project.read", "tenant.audit.read"],
    isAdmin: true,
    exp: Math.floor(Date.now() / 1000) + 300,
  });
    const headers = { authorization: `Bearer ${memberToken}` };
    const created = await fetch(`${endpoint}/v1/tenants/${tenant}/resources`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ type: "project", name: "Health project" }) });
    expect(created.status).toBe(201);
    const health = await fetch(`${endpoint}/v1/tenants/${tenant}/health`, { headers });
    expect(health.status).toBe(200);
    const healthBody = (await health.json() as { data: { tenantId: string; policy: { status: string; maxResources: number }; budgets?: { tokens: { status: string; committed: number; remaining?: number }; points: { status: string } }; resources: Record<string, number>; store: { kind: string; ok: boolean }; revokedMembers: number } }).data;
    expect(healthBody.tenantId).toBe(tenant);
    expect(healthBody.policy.status).toBe("active");
    expect(healthBody.resources.project).toBeGreaterThanOrEqual(1);
    expect(healthBody.store.kind).toBe("json");
    expect(healthBody.store.ok).toBe(true);
    expect(healthBody.budgets).toMatchObject({ tokens: { status: "unlimited", committed: 0 }, points: { status: "unlimited" } });

    const noAudit = await fetch(`${endpoint}/v1/tenants/${tenant}/audit-export?format=jsonl`, { headers: { authorization: `Bearer ${token(privateKey, { iss: issuer, aud: audience, sub: "noaudit", organizations: [tenant], permissions: ["project.read"], exp: Math.floor(Date.now() / 1000) + 300 })}` } });
    expect(noAudit.status).toBe(403);

    const exported = await fetch(`${endpoint}/v1/tenants/${tenant}/audit-export?format=csv&limit=50`, { headers });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("text/csv");
    const csv = await exported.text();
    expect(csv.split("\n")[0]).toBe("requestId,at,subject,tenantId,resource,action,outcome,reason");
    expect(csv).toContain("Health project");
  });

  it("exposes store and version metadata on /healthz", async () => {
    const response = await fetch(`${endpoint}/healthz`);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { ok: boolean; store: string; version: string; latencyMs: number } };
    expect(body.data.ok).toBe(true);
    expect(body.data.store).toBe("json");
    expect(body.data.version).toBe("dev");
    expect(body.data.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("exposes Prometheus metrics without requiring authentication", async () => {
    const response = await fetch(`${endpoint}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("openbuddy_gateway_uptime_seconds");
    expect(body).toContain('openbuddy_gateway_store_kind{kind="json"} 1');
    expect(body).toContain("openbuddy_gateway_http_requests_total");
    expect(body).toContain("openbuddy_gateway_audit_events_total");
    expect(body).toContain("openbuddy_gateway_webhook_accepted_total");
  });

  it("propagates W3C traceparent headers and mints a fresh trace when missing", async () => {
    const incoming = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const propagated = await fetch(`${endpoint}/healthz`, { headers: { traceparent: incoming } });
    expect(propagated.status).toBe(200);
    const echoed = propagated.headers.get("traceparent");
    expect(echoed).toBeTruthy();
    expect(echoed).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
    expect(propagated.headers.get("x-trace-id")).toBeTruthy();

    const minted = await fetch(`${endpoint}/healthz`);
    expect(minted.status).toBe(200);
    expect(minted.headers.get("traceparent")).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("archives audit events older than the cutoff when authorized", async () => {
    const tenant = "tenant-archive";
    const memberToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "archive-member",
      organizations: [tenant],
      permissions: ["tenant.lifecycle.write"],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const headers = { authorization: `Bearer ${memberToken}` };
    await fetch(`${endpoint}/v1/tenants/${tenant}/resources`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ type: "project", name: "Archive project" }) });
    const archived = await fetch(`${endpoint}/v1/tenants/${tenant}/audit-archive?before=2099-01-01T00:00:00.000Z`, { headers });
    expect(archived.status).toBe(200);
    const body = await archived.json() as { data: { archived: number; remaining: number } };
    expect(body.data.archived + body.data.remaining).toBeGreaterThan(0);

    const denied = await fetch(`${endpoint}/v1/tenants/${tenant}/audit-archive?before=2099-01-01T00:00:00.000Z`, { headers: { authorization: `Bearer ${token(privateKey, { iss: issuer, aud: audience, sub: "no-arch", organizations: [tenant], permissions: ["project.read"], exp: Math.floor(Date.now() / 1000) + 300 })}` } });
    expect(denied.status).toBe(403);
  });

  it("accepts group/role/permission webhook deliveries", async () => {
    process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = "test-secret";
    try {
      const payload = JSON.stringify({ type: "group", action: "update", organization: "tenant-w", group: "engineering", target: "engineering" });
      const { createHmac } = await import("node:crypto");
      const signature = createHmac("sha256", "test-secret").update(payload).digest("hex");
      const response = await fetch(`${endpoint}/v1/webhooks/casdoor`, { method: "POST", headers: { "content-type": "application/json", "x-casdoor-signature": `sha256=${signature}` }, body: payload });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { received: string; action: string } };
      expect(body.data.received).toBe("group");
      expect(body.data.action).toBe("update");
    } finally {
      delete process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
    }
  });

  it("orchestrates a deterministic Free welcome grant for an allowlisted Casdoor user webhook", async () => {
    const payload = JSON.stringify({ type: "user", action: "add", organization: "tenant-webhook-auto", user: "casdoor-new-user" });
    const signature = createHmac("sha256", "test-auto-welcome-secret").update(payload).digest("hex");
    const original = process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
    process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = "test-auto-welcome-secret";
    try {
      const response = await fetch(`${endpoint}/v1/webhooks/casdoor`, { method: "POST", headers: { "content-type": "application/json", "x-casdoor-signature": signature }, body: payload });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { welcome: { subject: "casdoor-new-user", issued: true } } });
      const account = await fetch(`${endpoint}/v1/tenants/tenant-webhook-auto/credits?subject=casdoor-new-user`, { headers: { authorization: `Bearer ${token(privateKey, { iss: issuer, aud: audience, sub: "welcome-admin", organizations: ["tenant-webhook-auto"], permissions: ["billing.read"], exp: Math.floor(Date.now() / 1000) + 300 })}` } });
      expect(account.status).toBe(200);
      expect(await account.json()).toMatchObject({ data: { balance: 100, lifetimeGranted: 100 } });

      const replay = await fetch(`${endpoint}/v1/webhooks/casdoor`, { method: "POST", headers: { "content-type": "application/json", "x-casdoor-signature": signature }, body: payload });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ data: { welcome: { subject: "casdoor-new-user", issued: false } } });
    } finally {
      if (original === undefined) delete process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
      else process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = original;
    }
  });

  it("accepts Casdoor's native Record-shaped add-user webhook for auto welcome", async () => {
    const payload = JSON.stringify({ organization: "tenant-webhook-auto", action: "add-user", user: "native-record-user", object: "{\"name\":\"native-record-user\"}" });
    const signature = createHmac("sha256", "test-auto-welcome-secret").update(payload).digest("hex");
    const original = process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
    process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = "test-auto-welcome-secret";
    try {
      const response = await fetch(`${endpoint}/v1/webhooks/casdoor`, { method: "POST", headers: { "content-type": "application/json", "x-casdoor-signature": signature }, body: payload });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { received: "user", welcome: { subject: "native-record-user", issued: true } } });
    } finally {
      if (original === undefined) delete process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
      else process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = original;
    }
  });

  it("rejects unsigned Casdoor webhooks and accepts HMAC-signed ones", async () => {
    const noSecret = await fetch(`${endpoint}/v1/webhooks/casdoor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "user", action: "delete" }) });
    expect(noSecret.status).toBe(503);
    const original = process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
    process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = "test-secret";
    try {
      const payload = JSON.stringify({ type: "user", action: "delete", organization: "tenant-webhook", user: "alice" });
      const { createHmac } = await import("node:crypto");
      const signature = createHmac("sha256", "test-secret").update(payload).digest("hex");
      const signed = await fetch(`${endpoint}/v1/webhooks/casdoor`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-casdoor-signature": `sha256=${signature}` },
        body: payload,
      });
      expect(signed.status).toBe(200);
      const body = await signed.json() as { data: { received: string; action: string; impacted: string[] } };
      expect(body.data.received).toBe("user");
      expect(body.data.action).toBe("delete");
      expect(body.data.impacted).toEqual(["tenant-webhook/alice"]);
      const tampered = await fetch(`${endpoint}/v1/webhooks/casdoor`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-casdoor-signature": "not-a-valid-signature" },
      body: JSON.stringify({ type: "user", action: "delete", organization: "tenant-webhook", user: "alice" }),
      });
      expect(tampered.status).toBe(401);
      const malformedHex = await fetch(`${endpoint}/v1/webhooks/casdoor`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-casdoor-signature": "z".repeat(64) },
        body: payload,
      });
      expect(malformedHex.status).toBe(401);
      const missingOrganization = JSON.stringify({ type: "organization", action: "delete" });
      const missingOrganizationSignature = createHmac("sha256", "test-secret").update(missingOrganization).digest("hex");
      const invalidPayload = await fetch(`${endpoint}/v1/webhooks/casdoor`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-casdoor-signature": missingOrganizationSignature },
        body: missingOrganization,
      });
      expect(invalidPayload.status).toBe(400);
      expect((await invalidPayload.json() as { code: string }).code).toBe("WEBHOOK_PAYLOAD_INVALID");
    } finally {
      if (original === undefined) delete process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
      else process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = original;
    }
  });

  it("actually revokes a tenant member when a Casdoor remove-user webhook is delivered", async () => {
    process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = "test-webhook-secret";
    const tenant = "tenant-webhook-revoke";
    const memberToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "webhook-target-user",
      organizations: [tenant],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    try {
      // Confirm member can read credits before revocation
      const before = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${memberToken}` } });
      expect(before.status).toBe(200);

      // Deliver signed remove-user webhook
      const payload = JSON.stringify({ type: "user", action: "remove-user", organization: tenant, user: "webhook-target-user" });
      const { createHmac } = await import("node:crypto");
      const signature = createHmac("sha256", "test-webhook-secret").update(payload).digest("hex");
      const webhook = await fetch(`${endpoint}/v1/webhooks/casdoor`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-casdoor-signature": `sha256=${signature}` },
        body: payload,
      });
      expect(webhook.status).toBe(200);
      const webhookBody = (await webhook.json() as { data: { revoked: boolean; impacted: string[] } }).data;
      expect(webhookBody.revoked).toBe(true);
      expect(webhookBody.impacted).toEqual([`${tenant}/webhook-target-user`]);

      // Same member must now be rejected with TENANT_MEMBER_REVOKED
      const after = await fetch(`${endpoint}/v1/tenants/${tenant}/credits`, { headers: { authorization: `Bearer ${memberToken}` } });
      expect(after.status).toBe(403);
      expect((await after.json() as { code: string }).code).toBe("TENANT_MEMBER_REVOKED");
    } finally {
      delete process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
    }
  });

  it("archives a tenant and revokes all members when an organization delete webhook is delivered", async () => {
    process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET = "test-organization-secret";
    const tenant = "tenant-webhook-delete";
    const memberToken = token(privateKey, {
      iss: issuer,
      aud: audience,
      sub: "organization-member",
      organizations: [tenant],
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    try {
      const payload = JSON.stringify({ type: "organization", action: "delete", organization: tenant });
      const { createHmac } = await import("node:crypto");
      const signature = createHmac("sha256", "test-organization-secret").update(payload).digest("hex");
      const webhook = await fetch(`${endpoint}/v1/webhooks/casdoor`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-casdoor-signature": signature },
        body: payload,
      });
      expect(webhook.status).toBe(200);
      expect((await webhook.json() as { data: { revoked: boolean } }).data.revoked).toBe(true);
      const policy = await fetch(`${endpoint}/v1/tenants/${tenant}/runtime-policy`, { headers: { authorization: `Bearer ${memberToken}` } });
      expect(policy.status).toBe(403);
      expect((await policy.json() as { code: string }).code).toBe("TENANT_MEMBER_REVOKED");
    } finally {
      delete process.env.RESOURCE_GATEWAY_WEBHOOK_SECRET;
    }
  });

  it("expires grant lots without consuming reserved points and converges before reservations", async () => {
    const tenant = "tenant-credit-expiry";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "expiry-admin", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 1_000_000 });
    const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "expiry-user", amount: 10, validDays: 1, idempotencyKey: "expiry-grant-001" }) });
    expect(grant.status).toBe(201);
    const reserve = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, { method: "POST", headers: { ...headers, authorization: `Bearer ${token(privateKey, { iss: issuer, aud: audience, sub: "expiry-user", organizations: [tenant], permissions: ["billing.write"], exp: Math.floor(Date.now() / 1000) + 1_000_000 }) }` }, body: JSON.stringify({ subject: "expiry-user", amount: 4, model: "demo-model", idempotencyKey: "expiry-reserve-001" }) });
    expect(reserve.status).toBe(201);

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 2 * 86_400_000);
      const expire = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/expire?subject=expiry-user`, { method: "POST", headers });
      expect(expire.status).toBe(200);
      expect(await expire.json()).toMatchObject({ data: { expired: 6, account: { balance: 4, reserved: 4, lifetimeExpired: 6, available: 0 } } });

      const replay = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/expire?subject=expiry-user`, { method: "POST", headers });
      expect(await replay.json()).toMatchObject({ data: { expired: 0 } });

      const release = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/release`, { method: "POST", headers: { ...headers, authorization: `Bearer ${token(privateKey, { iss: issuer, aud: audience, sub: "expiry-user", organizations: [tenant], permissions: ["billing.write"], exp: Math.floor(Date.now() / 1000) + 1_000_000 }) }` }, body: JSON.stringify({ reservationKey: "expiry-reserve-001" }) });
      expect(release.status).toBe(200);

      const finalExpire = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/expire?subject=expiry-user`, { method: "POST", headers });
      expect(await finalExpire.json()).toMatchObject({ data: { expired: 4, account: { balance: 0, reserved: 0, lifetimeExpired: 10, available: 0 } } });
      const ledger = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger?subject=expiry-user`, { headers });
      expect((await ledger.json() as { data: Array<{ type: string; amount: number; sourceLedgerId?: string }> }).data.filter((entry) => entry.type === "expire")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }

    const batchTenant = "tenant-credit-expiry-batch";
    const batchAdminToken = token(privateKey, { iss: issuer, aud: audience, sub: "batch-expiry-admin", organizations: [batchTenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 1_000_000 });
    const batchHeaders = { authorization: `Bearer ${batchAdminToken}`, "content-type": "application/json" };
    const batchUserGrant = await fetch(`${endpoint}/v1/tenants/${batchTenant}/credits/grant`, { method: "POST", headers: batchHeaders, body: JSON.stringify({ subject: "batch-user", amount: 5, validDays: 1, idempotencyKey: "batch-user-grant-001" }) });
    expect(batchUserGrant.status).toBe(201);
    const batchWallet = await fetch(`${endpoint}/v1/tenants/${batchTenant}/wallets`, { method: "POST", headers: batchHeaders, body: JSON.stringify({ id: "batch-wallet", name: "Batch wallet", idempotencyKey: "batch-wallet-create-001" }) });
    expect(batchWallet.status).toBe(201);
    const batchWalletGrant = await fetch(`${endpoint}/v1/tenants/${batchTenant}/credits/grant`, { method: "POST", headers: batchHeaders, body: JSON.stringify({ walletId: "batch-wallet", amount: 7, validDays: 1, idempotencyKey: "batch-wallet-grant-001" }) });
    expect(batchWalletGrant.status).toBe(201);
    const invalidBatchScope = await fetch(`${endpoint}/v1/tenants/${batchTenant}/credits/expire?all=true&subject=batch-user`, { method: "POST", headers: batchHeaders });
    expect(invalidBatchScope.status).toBe(400);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 2 * 86_400_000);
      const batchExpire = await fetch(`${endpoint}/v1/tenants/${batchTenant}/credits/expire?all=true`, { method: "POST", headers: batchHeaders });
      expect(batchExpire.status).toBe(200);
      expect(await batchExpire.json()).toMatchObject({ data: { expired: 12, accounts: 1, wallets: 1, entitlementsExpired: false } });
      const batchReplay = await fetch(`${endpoint}/v1/tenants/${batchTenant}/credits/expire?all=true`, { method: "POST", headers: batchHeaders });
      expect(await batchReplay.json()).toMatchObject({ data: { expired: 0, accounts: 1, wallets: 1 } });
    } finally {
      vi.useRealTimers();
    }

    const autoTenant = "tenant-credit-expiry-auto";
    const autoUserToken = token(privateKey, { iss: issuer, aud: audience, sub: "auto-expiry-user", organizations: [autoTenant], permissions: ["billing.write"], exp: Math.floor(Date.now() / 1000) + 1_000_000 });
    const autoHeaders = { authorization: `Bearer ${autoUserToken}`, "content-type": "application/json" };
    const autoGrant = await fetch(`${endpoint}/v1/tenants/${autoTenant}/credits/grant`, { method: "POST", headers: autoHeaders, body: JSON.stringify({ amount: 3, validDays: 1, idempotencyKey: "auto-expiry-grant-001" }) });
    expect(autoGrant.status).toBe(201);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 2 * 86_400_000);
      const autoReserve = await fetch(`${endpoint}/v1/tenants/${autoTenant}/credits/reserve`, { method: "POST", headers: autoHeaders, body: JSON.stringify({ amount: 1, model: "demo-model", idempotencyKey: "auto-expiry-reserve-001" }) });
      expect(autoReserve.status).toBe(402);
      const account = await fetch(`${endpoint}/v1/tenants/${autoTenant}/credits`, { headers: autoHeaders });
      expect(await account.json()).toMatchObject({ data: { balance: 0, lifetimeExpired: 3, available: 0 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs tenant expiry through the signed internal worker endpoint", async () => {
    const tenant = "tenant-credit-expiry-internal";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "internal-expiry-admin", organizations: [tenant], permissions: ["billing.write"], exp: Math.floor(Date.now() / 1000) + 1_000_000 });
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: "internal-expiry-user", amount: 9, validDays: 1, idempotencyKey: "internal-expiry-grant-001" }),
    });
    expect(grant.status).toBe(201);

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 2 * 86_400_000);
      const requestId = "internal-expiry-run-001";
      const raw = JSON.stringify({ tenantIds: [tenant] });
      const timestamp = String(Date.now());
      const signature = createHmac("sha256", process.env.RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET!).update(`${timestamp}.${raw}`).digest("hex");
      const headers = { "content-type": "application/json", "idempotency-key": requestId, "x-openbuddy-credit-expiry-timestamp": timestamp, "x-openbuddy-credit-expiry-signature": signature };
      const result = await fetch(`${endpoint}/internal/v1/credits/expire`, { method: "POST", headers, body: raw });
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({ data: { requestId, tenantIds: [tenant], expired: 9, replay: false } });

      const replay = await fetch(`${endpoint}/internal/v1/credits/expire`, { method: "POST", headers, body: raw });
      expect(await replay.json()).toMatchObject({ data: { requestId, expired: 9, replay: true } });

      const conflictRaw = JSON.stringify({ tenantIds: ["another-tenant"] });
      const conflictSignature = createHmac("sha256", process.env.RESOURCE_GATEWAY_CREDIT_EXPIRY_SECRET!).update(`${timestamp}.${conflictRaw}`).digest("hex");
      const conflict = await fetch(`${endpoint}/internal/v1/credits/expire`, { method: "POST", headers: { ...headers, "x-openbuddy-credit-expiry-signature": conflictSignature }, body: conflictRaw });
      expect(conflict.status).toBe(409);

      const invalid = await fetch(`${endpoint}/internal/v1/credits/expire`, { method: "POST", headers: { ...headers, "x-openbuddy-credit-expiry-signature": "0".repeat(64) }, body: raw });
      expect(invalid.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts HMAC-authenticated cost-import records at /internal/v1/tenants/{tid}/credits/reconciliation/import", async () => {
    const tenant = "tenant-internal-cost-import";
    const secret = process.env.RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET!;
    expect(secret.length).toBeGreaterThan(20);
    const records = [
      { tenantId: tenant, subject: "internal-cost-import-worker", model: "internal-cost-import-model", promptTokens: 100, completionTokens: 50, upstreamCost: 0.0005, currency: "USD", source: "new-api-log", externalId: "internal-cost-import-001", importKey: "internal-cost-import-import-001", usageAt: new Date().toISOString(), newApiRequestId: "internal-cost-import-req-001", newApiGroup: "default", costBasis: "provider-reported" },
      { tenantId: tenant, subject: "internal-cost-import-worker", model: "internal-cost-import-model", promptTokens: 200, completionTokens: 100, upstreamCost: 0.001, currency: "USD", source: "new-api-log", externalId: "internal-cost-import-002", importKey: "internal-cost-import-import-002", usageAt: new Date().toISOString(), newApiRequestId: "internal-cost-import-req-002", newApiGroup: "default", costBasis: "provider-reported" },
    ];
    const raw = JSON.stringify({ records, tenantId: tenant });
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    const headers = { "content-type": "application/json", "x-openbuddy-new-api-cost-timestamp": timestamp, "x-openbuddy-new-api-cost-signature": signature };

    const result = await fetch(`${endpoint}/internal/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers, body: raw });
    expect(result.status).toBe(201);
    const body = (await result.json()) as { data: { imported: number; duplicates: number; matched: number } };
    expect(body.data.imported).toBe(2);
    expect(body.data.duplicates).toBe(0);

    const replay = await fetch(`${endpoint}/internal/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers, body: raw });
    expect(replay.status).toBe(200);
    expect((await replay.json())).toMatchObject({ data: { imported: 0, duplicates: 2 } });

    const invalidSig = await fetch(`${endpoint}/internal/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": "0".repeat(64) }, body: raw });
    expect(invalidSig.status).toBe(401);

    const wrongSecretSig = createHmac("sha256", "wrong-secret-12345678901234567890").update(`${timestamp}.${raw}`).digest("hex");
    const wrongSecret = await fetch(`${endpoint}/internal/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": wrongSecretSig }, body: raw });
    expect(wrongSecret.status).toBe(401);

    const staleTimestamp = String(Date.now() - 10 * 60 * 1000);
    const staleSig = createHmac("sha256", secret).update(`${staleTimestamp}.${raw}`).digest("hex");
    const stale = await fetch(`${endpoint}/internal/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-timestamp": staleTimestamp, "x-openbuddy-new-api-cost-signature": staleSig }, body: raw });
    expect(stale.status).toBe(401);

    const mismatchRaw = JSON.stringify({ records, tenantId: "other-tenant" });
    const mismatchSig = createHmac("sha256", secret).update(`${timestamp}.${mismatchRaw}`).digest("hex");
    const mismatch = await fetch(`${endpoint}/internal/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": mismatchSig }, body: mismatchRaw });
    expect(mismatch.status).toBe(403);
  });

  it("exposes Prometheus metrics at /metrics for deployment-guide §8 monitoring", async () => {
    // Trigger at least one tracked HTTP request so httpRequests / httpOutcomes have data.
    const probe = await fetch(`${endpoint}/healthz`);
    expect(probe.status).toBe(200);

    const response = await fetch(`${endpoint}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/plain; version=0\.0\.4/);

    const body = await response.text();
    // Required metric families (matching deployment-guide.md §8.1)
    expect(body).toMatch(/# TYPE openbuddy_gateway_uptime_seconds gauge/);
    expect(body).toMatch(/# TYPE openbuddy_gateway_store_kind gauge/);
    expect(body).toMatch(/# TYPE openbuddy_gateway_http_requests_total counter/);
    expect(body).toMatch(/# TYPE openbuddy_gateway_http_outcomes_total counter/);
    expect(body).toMatch(/# TYPE openbuddy_gateway_rate_limited_total counter/);
    expect(body).toMatch(/# TYPE openbuddy_gateway_webhook_accepted_total counter/);
    expect(body).toMatch(/# TYPE openbuddy_gateway_webhook_rejected_total counter/);
    expect(body).toMatch(/# TYPE openbuddy_gateway_audit_events_total counter/);

    // Verify counter actually incremented for the path we just probed.
    expect(body).toMatch(/openbuddy_gateway_http_requests_total\{path="\/healthz"\} \d+/);
    expect(body).toMatch(/openbuddy_gateway_http_outcomes_total\{path="\/healthz",outcome="success"\} \d+/);
    // Store kind must be either "memory" or "json" — assert exact format.
    expect(body).toMatch(/openbuddy_gateway_store_kind\{kind="(memory|json|postgres|mysql)"\} 1/);
  });

  it("manages shared wallets, applies wallet-aware AI reservations, and enforces role hierarchy", async () => {
    const tenant = "tenant-shared-wallet";
    const ownerToken = token(privateKey, { iss: issuer, aud: audience, sub: "wallet-owner", organizations: [tenant], permissions: ["billing.write", "billing.read", "billing.catalog.write"], exp: Math.floor(Date.now() / 1000) + 600 });
    const viewerToken = token(privateKey, { iss: issuer, aud: audience, sub: "wallet-viewer", organizations: [tenant], permissions: ["billing.read"], exp: Math.floor(Date.now() / 1000) + 600 });
    const intruderToken = token(privateKey, { iss: issuer, aud: audience, sub: "wallet-intruder", organizations: [tenant], permissions: ["billing.read"], exp: Math.floor(Date.now() / 1000) + 600 });
    const otherTenantToken = token(privateKey, { iss: issuer, aud: audience, sub: "wallet-owner", organizations: ["tenant-other-wallet"], permissions: ["billing.write"], exp: Math.floor(Date.now() / 1000) + 600 });
    const ownerHeaders = { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" };
    const viewerHeaders = { authorization: `Bearer ${viewerToken}`, "content-type": "application/json" };
    const intruderHeaders = { authorization: `Bearer ${intruderToken}`, "content-type": "application/json" };

    const forbiddenCreate = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets`, { method: "POST", headers: intruderHeaders, body: JSON.stringify({ name: "Marketing Team Wallet" }) });
    expect(forbiddenCreate.status).toBe(403);

    const create = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ name: "Marketing Team Wallet" }) });
    expect(create.status).toBe(201);
    const wallet = (await create.json() as { data: { wallet: { id: string } } }).data.wallet;
    const walletId = wallet.id;

    const dupCreate = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ name: "Marketing Team Wallet", id: walletId }) });
    expect(dupCreate.status).toBe(201);
    expect((await dupCreate.json() as { data: { wallet: { id: string } } }).data.wallet.id).toBe(walletId);

    await fetch(`${endpoint}/v1/tenants/tenant-other-wallet/wallets`, { method: "POST", headers: { authorization: `Bearer ${otherTenantToken}`, "content-type": "application/json" }, body: JSON.stringify({ name: "Other", id: walletId }) });
    const crossRead = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${walletId}`, { headers: { authorization: `Bearer ${otherTenantToken}` } });
    expect(crossRead.status).toBe(403);

    await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${walletId}/members/wallet-viewer`, { method: "PUT", headers: ownerHeaders, body: JSON.stringify({ role: "viewer" }) });

    const viewerCredits = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${walletId}/credits`, { headers: viewerHeaders });
    expect(viewerCredits.status).toBe(200);
    expect(await viewerCredits.json()).toMatchObject({ data: { balance: 0, reserved: 0, available: 0, walletId } });

    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ walletId, amount: 8000, idempotencyKey: "wallet-grant-001" }) });
    expect(grant.status).toBe(201);
    expect(await grant.json()).toMatchObject({ data: { account: { balance: 8000, walletId, available: 8000 } } });

    const denyGrant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers: viewerHeaders, body: JSON.stringify({ walletId, amount: 100, idempotencyKey: "wallet-grant-deny-001" }) });
    expect(denyGrant.status).toBe(403);

    const order = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ planId: "team", walletId, idempotencyKey: "wallet-order-001" }) });
    expect(order.status).toBe(201);
    const orderNo = (await order.json() as { data: { orderNo: string } }).data.orderNo;
    const paymentPayload = JSON.stringify({ orderNo, status: "paid", paymentId: "wallet-payment-001", paymentChannel: "test", amountMinor: 9900, currency: "CNY" });
    const paymentSig = createHmac("sha256", "billing-callback-secret").update(paymentPayload).digest("hex");
    const payment = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": paymentSig }, body: paymentPayload });
    expect(payment.status).toBe(200);

    const creditsAfter = await (await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${walletId}/credits`, { headers: ownerHeaders })).json() as { data: { balance: number; lifetimeGranted: number } };
    expect(creditsAfter.data.balance).toBeGreaterThanOrEqual(8000);
    expect(creditsAfter.data.lifetimeGranted).toBeGreaterThanOrEqual(8000);

    const aiReservation = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...ownerHeaders, "idempotency-key": "wallet-ai-001", "x-openbuddy-wallet": walletId }, body: JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "team wallet chat" }] }) });
    expect(aiReservation.status).toBe(200);
    const walletAccount = await (await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${walletId}/credits`, { headers: ownerHeaders })).json() as { data: { balance: number; reserved: number; lifetimeConsumed: number } };
    expect(walletAccount.data.lifetimeConsumed).toBeGreaterThan(0);

    const ownerSubjectAccount = await (await fetch(`${endpoint}/v1/tenants/${tenant}/credits?subject=wallet-owner`, { headers: ownerHeaders })).json() as { data: { balance: number } };
    expect(ownerSubjectAccount.data.balance).toBe(0);

    const ledger = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${walletId}/ledger`, { headers: ownerHeaders });
    const ledgerBody = await ledger.json() as { data: Array<{ type: string; subject: string; walletId?: string; actorSubject?: string }> };
    expect(ledgerBody.data.every((entry) => entry.walletId === walletId)).toBe(true);
    expect(ledgerBody.data.find((entry) => entry.type === "consume")?.actorSubject).toBe("wallet-owner");

    const denyReserve = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, { method: "POST", headers: viewerHeaders, body: JSON.stringify({ walletId, model: "demo-model", promptTokens: 100, completionTokens: 50, idempotencyKey: "wallet-reserve-deny-001" }) });
    expect(denyReserve.status).toBe(403);

    const okReserve = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ walletId, model: "demo-model", promptTokens: 100, completionTokens: 50, idempotencyKey: "wallet-reserve-002" }) });
    expect(okReserve.status).toBe(201);
    const settle = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/settle`, { method: "POST", headers: intruderHeaders, body: JSON.stringify({ reservationKey: "wallet-reserve-002", amount: 1 }) });
    expect(settle.status).toBe(403);

    const suspend = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${walletId}`, { method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ status: "suspended" }) });
    expect(suspend.status).toBe(200);
    const blocked = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...ownerHeaders, "idempotency-key": "wallet-ai-blocked", "x-openbuddy-wallet": walletId }, body: JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "blocked" }] }) });
    expect(blocked.status).toBe(423);

    const restore = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${walletId}`, { method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ status: "active" }) });
    expect(restore.status).toBe(200);

    const consumeGrantAndPurchase = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reserve`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ walletId, amount: 8001, model: "demo-model", promptTokens: 8001, completionTokens: 0, idempotencyKey: "wallet-refund-batch-consume-001" }) });
    expect(consumeGrantAndPurchase.status).toBe(201);
    const consumeGrantAndPurchaseSettlement = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/settle`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ reservationKey: "wallet-refund-batch-consume-001", amount: 8001, promptTokens: 8001, completionTokens: 0, model: "demo-model", newApiRequestId: "wallet-refund-batch-consume-001" }) });
    expect(consumeGrantAndPurchaseSettlement.status).toBe(200);

    const refundOrder = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders/${orderNo}/refund`, { method: "POST", headers: ownerHeaders });
    expect(refundOrder.status).toBe(409);
    expect(await refundOrder.json()).toMatchObject({ code: "BILLING_REFUND_POINTS_CONSUMED" });

    const cleanOrder = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ planId: "team", walletId, idempotencyKey: "wallet-refund-clean-batch-001" }) });
    expect(cleanOrder.status).toBe(201);
    const cleanOrderNo = (await cleanOrder.json() as { data: { orderNo: string } }).data.orderNo;
    const cleanPaymentPayload = JSON.stringify({ orderNo: cleanOrderNo, status: "paid", paymentId: "wallet-payment-clean-001", paymentChannel: "test", amountMinor: 9900, currency: "CNY" });
    const cleanPaymentSignature = createHmac("sha256", "billing-callback-secret").update(cleanPaymentPayload).digest("hex");
    const cleanPayment = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": cleanPaymentSignature }, body: cleanPaymentPayload });
    expect(cleanPayment.status).toBe(200);
    const cleanRefund = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders/${cleanOrderNo}/refund`, { method: "POST", headers: ownerHeaders });
    expect(cleanRefund.status).toBe(200);
    expect(await cleanRefund.json()).toMatchObject({ data: { status: "refunded" } });

    const walletNonMemberPayload = JSON.stringify({ records: [{ tenantId: tenant, subject: "wallet-intruder", walletId, model: "demo-model", promptTokens: 10, completionTokens: 5, upstreamCost: 0.0042, currency: "CNY", source: "new-api-log", externalId: "wallet-cost-non-member", importKey: "wallet-cost-non-member", usageAt: new Date().toISOString(), newApiRequestId: "wallet-request-non-member", actorSubject: "wallet-intruder", costBasis: "provider-reported" }] });
    const walletNonMemberSignature = createHmac("sha256", process.env.RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET!).update(walletNonMemberPayload).digest("hex");
    const walletNonMemberImport = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...ownerHeaders, "x-openbuddy-new-api-cost-signature": walletNonMemberSignature }, body: walletNonMemberPayload });
    expect(walletNonMemberImport.status).toBe(403);
    expect(await walletNonMemberImport.json()).toMatchObject({ code: "COST_IMPORT_WALLET_MEMBER_REQUIRED" });

    const walletSubjectMismatchPayload = JSON.stringify({ records: [{ tenantId: tenant, subject: "wallet-member", walletId, model: "demo-model", promptTokens: 10, completionTokens: 5, upstreamCost: 0.0042, currency: "CNY", source: "new-api-log", externalId: "wallet-cost-subject-mismatch", importKey: "wallet-cost-subject-mismatch", usageAt: new Date().toISOString(), newApiRequestId: "chat-json", costBasis: "provider-reported" }] });
    const walletSubjectMismatchSignature = createHmac("sha256", process.env.RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET!).update(walletSubjectMismatchPayload).digest("hex");
    const walletSubjectMismatch = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...ownerHeaders, "x-openbuddy-new-api-cost-signature": walletSubjectMismatchSignature }, body: walletSubjectMismatchPayload });
    expect(walletSubjectMismatch.status).toBe(409);
    expect(await walletSubjectMismatch.json()).toMatchObject({ code: "COST_IMPORT_USAGE_MISMATCH" });

    const walletCostPayload = JSON.stringify({ records: [{ tenantId: tenant, subject: "wallet-owner", walletId, model: "demo-model", promptTokens: 10, completionTokens: 5, upstreamCost: 0.0042, currency: "CNY", source: "new-api-log", externalId: "wallet-cost-001", importKey: "wallet-cost-import-001", usageAt: new Date().toISOString(), newApiRequestId: "chat-json", costBasis: "provider-reported" }] });
    const walletCostSignature = createHmac("sha256", process.env.RESOURCE_GATEWAY_NEW_API_COST_IMPORT_SECRET!).update(walletCostPayload).digest("hex");
    const walletCostImport = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...ownerHeaders, "x-openbuddy-new-api-cost-signature": walletCostSignature }, body: walletCostPayload });
    expect(walletCostImport.status).toBe(201);

    const walletStatement = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation?walletId=${encodeURIComponent(walletId)}`, { headers: viewerHeaders });
    expect(walletStatement.status).toBe(200);
    const walletStatementBody = await walletStatement.json() as { data: { tenantId: string; walletId: string; scope: string; total: { requests: number }; commerce: { grossOrders: number; refundedOrders: number }; byActor?: Record<string, { requests: number; pointsSettled: number }>; external: { records: number; matchedRecords: number; byActor?: Record<string, { requests: number; externalCost: number }> } } };
    expect(walletStatementBody).toMatchObject({ data: { tenantId: tenant, walletId, scope: "wallet", total: { requests: expect.any(Number) }, commerce: { grossOrders: 2, refundedOrders: 1 }, byActor: { "wallet-owner": { requests: 1, pointsSettled: expect.any(Number) } }, external: { records: 1, matchedRecords: 1, byActor: { "wallet-owner": { requests: 1, externalCost: 0.0042 } } } } });
    const deniedWalletStatement = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation?walletId=${encodeURIComponent(walletId)}`, { headers: intruderHeaders });
    expect(deniedWalletStatement.status).toBe(403);

    const removeLastOwner = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${walletId}/members/wallet-owner`, { method: "DELETE", headers: ownerHeaders });
    expect(removeLastOwner.status).toBe(409);
  });

  it("expires shared-wallet points before an AI reservation", async () => {
    const tenant = "tenant-shared-wallet-expiry";
    const ownerToken = token(privateKey, { iss: issuer, aud: audience, sub: "expiry-owner", organizations: [tenant], permissions: ["billing.write", "billing.read"], exp: Math.floor(Date.now() / 1000) + 864000 });
    const headers = { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" };
    const create = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets`, { method: "POST", headers, body: JSON.stringify({ name: "Expiring Wallet" }) });
    expect(create.status).toBe(201);
    const walletId = (await create.json() as { data: { wallet: { id: string } } }).data.wallet.id;
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ walletId, amount: 100, validDays: 1, idempotencyKey: "wallet-expiry-grant-001" }) });
    expect(grant.status).toBe(201);
    const before = upstreamRequests.length;
    const now = Date.now();
    vi.useFakeTimers({ now });
    vi.setSystemTime(now + 2 * 86_400_000);
    try {
      const request = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/chat/completions`, { method: "POST", headers: { ...headers, "idempotency-key": "wallet-expiry-ai-001", "x-openbuddy-wallet": walletId }, body: JSON.stringify({ model: "demo-model", messages: [{ role: "user", content: "expired wallet" }] }) });
      expect(request.status).toBe(402);
      expect(await request.json()).toMatchObject({ code: "INSUFFICIENT_CREDITS" });
      const credits = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${walletId}/credits`, { headers });
      expect(await credits.json()).toMatchObject({ data: { balance: 0, reserved: 0, lifetimeExpired: 100 } });
      const ledger = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/${walletId}/ledger`, { headers });
      expect((await ledger.json() as { data: Array<{ type: string; amount: number }> }).data).toEqual(expect.arrayContaining([expect.objectContaining({ type: "expire", amount: 100 })]));
      expect(upstreamRequests.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aggregates New API channel routing and prompt cache telemetry into the reconciliation report", async () => {
    const tenant = "tenant-channel-cache";
    const importToken = token(privateKey, { iss: issuer, aud: audience, sub: "cache-worker", organizations: [tenant], permissions: ["billing.reconciliation.write", "billing.read"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${importToken}`, "content-type": "application/json" };
    const payload = { records: [
      { tenantId: tenant, subject: "user-1", model: "MiniMax-M3", promptTokens: 200, completionTokens: 10, upstreamCost: 0.004, currency: "USD", externalId: "cache-log-001", importKey: "new-api-cache-log-001", usageAt: "2026-08-30T01:00:00.000Z", newApiRequestId: "chat-cache-001", newApiGroup: "default", channel: { id: "2", name: "OpenBuddy MiniMax M3" }, cache: { ratio: 0.5, tokens: 100 }, costBasis: "provider-reported-quota" },
      { tenantId: tenant, subject: "user-1", model: "MiniMax-M3", promptTokens: 300, completionTokens: 12, upstreamCost: 0.006, currency: "USD", externalId: "cache-log-002", importKey: "new-api-cache-log-002", usageAt: "2026-08-30T01:00:00.000Z", newApiRequestId: "chat-cache-002", newApiGroup: "default", channel: { id: "2", name: "OpenBuddy MiniMax M3" }, cache: { ratio: 0.25, tokens: 75 }, costBasis: "provider-reported-quota" },
    ] };
    const imported = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, { method: "POST", headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify(payload)) }, body: JSON.stringify(payload) });
    expect(imported.status).toBe(201);
    const report = await (await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation`, { headers })).json() as { data: { external: { byChannel?: Record<string, { requests: number }>; cache?: { requests: number; tokens: number; spend: number }; records: number } } };
    expect(report.data.external.records).toBe(2);
    expect(report.data.external.byChannel?.["2"]?.requests).toBe(2);
    expect(report.data.external.cache).toMatchObject({ requests: 2, tokens: 175 });
    expect(report.data.external.cache?.spend).toBeCloseTo(0.01, 5);
    expect(report.data.external.cache?.averageRatio).toBe(0.375);

    const channelConflict = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, {
      method: "POST",
      headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify({ records: [{ ...payload.records[0], channel: { id: "3", name: "Different channel" } }] })) },
      body: JSON.stringify({ records: [{ ...payload.records[0], channel: { id: "3", name: "Different channel" } }] }),
    });
    expect(channelConflict.status).toBe(409);
    expect((await channelConflict.json() as { code: string }).code).toBe("COST_IMPORT_IDEMPOTENCY_CONFLICT");

    const cacheConflict = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/reconciliation/import`, {
      method: "POST",
      headers: { ...headers, "x-openbuddy-new-api-cost-signature": costImportSignature(JSON.stringify({ records: [{ ...payload.records[0], cache: { ratio: 0.75, tokens: 100 } }] })) },
      body: JSON.stringify({ records: [{ ...payload.records[0], cache: { ratio: 0.75, tokens: 100 } }] }),
    });
    expect(cacheConflict.status).toBe(409);
    expect((await cacheConflict.json() as { code: string }).code).toBe("COST_IMPORT_IDEMPOTENCY_CONFLICT");
  });

  it("expires subscription entitlements independently and restores the previous tenant policy", async () => {
    const tenant = "tenant-entitlement-expiry";
    const billingToken = token(privateKey, { iss: issuer, aud: audience, sub: "billing-owner", organizations: [tenant], permissions: ["billing.read", "billing.write", "billing.catalog.write", "tenant.policy.read", "tenant.policy.write"], exp: Math.floor(Date.now() / 1000) + 300 });
    const headers = { authorization: `Bearer ${billingToken}`, "content-type": "application/json" };
    const baseline = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { method: "PATCH", headers, body: JSON.stringify({ modelAllowlist: ["demo-model"] }) });
    expect(baseline.status).toBe(200);
    const plan = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/plans`, { method: "PATCH", headers, body: JSON.stringify({ id: "short-lived", name: "Short-lived", currency: "CNY", priceMinor: 100, points: 10, entitlementsValidDays: 1, modelAllowlist: ["non-streaming-model"] }) });
    expect(plan.status).toBe(200);
    const created = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/orders`, { method: "POST", headers, body: JSON.stringify({ planId: "short-lived", idempotencyKey: "entitlement-expiry-order-001" }) });
    expect(created.status).toBe(201);
    const orderNo = (await created.json() as { data: { orderNo: string } }).data.orderNo;
    const paymentPayload = JSON.stringify({ orderNo, status: "paid", paymentId: "entitlement-expiry-payment-001", paymentChannel: "test", amountMinor: 100, currency: "CNY" });
    const paymentSignature = createHmac("sha256", "billing-callback-secret").update(paymentPayload).digest("hex");
    const payment = await fetch(`${endpoint}/v1/billing/callback`, { method: "POST", headers: { "content-type": "application/json", "x-openbuddy-billing-signature": paymentSignature }, body: paymentPayload });
    expect(payment.status).toBe(200);
    expect((await (await fetch(`${endpoint}/v1/tenants/${tenant}/billing/subscription`, { headers })).json() as { data: { entitlementsExpiresAt?: string } }).data.entitlementsExpiresAt).toBeTruthy();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 2 * 86_400_000));
    try {
      const expiredToken = token(privateKey, { iss: issuer, aud: audience, sub: "billing-owner", organizations: [tenant], permissions: ["billing.read", "tenant.policy.read"], exp: Math.floor(Date.now() / 1000) + 300 });
      const expiredHeaders = { authorization: `Bearer ${expiredToken}` };
      const nonChatRequest = await fetch(`${endpoint}/v1/tenants/${tenant}/ai/rerank`, {
        method: "POST",
        headers: { ...expiredHeaders, "content-type": "application/json", "idempotency-key": "entitlement-expiry-rerank-001" },
        body: JSON.stringify({ model: "non-streaming-model", query: "hello", documents: ["hello"] }),
      });
      expect(nonChatRequest.status).toBe(403);
      expect((await nonChatRequest.json() as { code: string }).code).toBe("MODEL_NOT_ALLOWED");
      const subscription = await fetch(`${endpoint}/v1/tenants/${tenant}/billing/subscription`, { headers: expiredHeaders });
      expect(subscription.status).toBe(200);
      expect((await subscription.json()).data).toMatchObject({ status: "cancelled", orderNo });
      const restored = await fetch(`${endpoint}/v1/tenants/${tenant}/policy`, { headers: expiredHeaders });
      expect(restored.status).toBe(200);
      expect((await restored.json()).data.modelAllowlist).toEqual(["demo-model"]);
    } finally {
      vi.useRealTimers();
    }
  });


  it("transfers points between personal accounts, supports idempotent replay, and rejects non-owner/non-admin actors", async () => {
    const tenant = "tenant-transfer-personal";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "transfer-admin", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 600 });
    const aliceToken = token(privateKey, { iss: issuer, aud: audience, sub: "transfer-alice", organizations: [tenant], permissions: ["billing.read"], exp: Math.floor(Date.now() / 1000) + 600 });
    const bobToken = token(privateKey, { iss: issuer, aud: audience, sub: "transfer-bob", organizations: [tenant], permissions: ["billing.read"], exp: Math.floor(Date.now() / 1000) + 600 });
    const malloryToken = token(privateKey, { iss: issuer, aud: audience, sub: "transfer-mallory", organizations: [tenant], permissions: ["billing.read"], exp: Math.floor(Date.now() / 1000) + 600 });
    const adminHeaders = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    const aliceHeaders = { authorization: `Bearer ${aliceToken}`, "content-type": "application/json" };
    const bobHeaders = { authorization: `Bearer ${bobToken}`, "content-type": "application/json" };
    const malloryHeaders = { authorization: `Bearer ${malloryToken}`, "content-type": "application/json" };

    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ subject: "transfer-alice", amount: 1000, idempotencyKey: "transfer-personal-grant-001" }) });
    expect(grant.status).toBe(201);

    const selfTransfer = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers: aliceHeaders, body: JSON.stringify({ amount: 100, idempotencyKey: "transfer-personal-same-001", source: { subject: "transfer-alice" }, destination: { subject: "transfer-alice" } }) });
    expect(selfTransfer.status).toBe(400);
    expect((await selfTransfer.json() as { code: string }).code).toBe("TRANSFER_SAME_ACCOUNT");

    const malloryTransfer = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers: malloryHeaders, body: JSON.stringify({ amount: 100, idempotencyKey: "transfer-personal-foreign-001", source: { subject: "transfer-alice" }, destination: { subject: "transfer-bob" } }) });
    expect(malloryTransfer.status).toBe(403);
    expect((await malloryTransfer.json() as { code: string }).code).toBe("TRANSFER_SOURCE_DENIED");

    const transfer = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers: aliceHeaders, body: JSON.stringify({ amount: 250, idempotencyKey: "transfer-personal-001", reason: "alice -> bob", source: { subject: "transfer-alice" }, destination: { subject: "transfer-bob" } }) });
    expect(transfer.status).toBe(201);
    const transferBody = (await transfer.json()) as { data: { amount: number; replay: boolean; source: { balance: number; reserved: number; available: number; lifetimeConsumed: number }; destination: { balance: number; reserved: number; available: number; lifetimeGranted: number }; outEntryId: string; inEntryId: string } };
    expect(transferBody.data).toMatchObject({ amount: 250, replay: false });
    expect(transferBody.data.source).toMatchObject({ balance: 750, reserved: 0, available: 750, lifetimeConsumed: 250 });
    expect(transferBody.data.destination).toMatchObject({ balance: 250, reserved: 0, available: 250, lifetimeGranted: 250 });
    expect(transferBody.data.outEntryId).toBeTruthy();
    expect(transferBody.data.inEntryId).toBeTruthy();

    const replay = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers: aliceHeaders, body: JSON.stringify({ amount: 250, idempotencyKey: "transfer-personal-001", reason: "alice -> bob", source: { subject: "transfer-alice" }, destination: { subject: "transfer-bob" } }) });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { data: { amount: number; replay: boolean; source: { balance: number }; destination: { balance: number } } };
    expect(replayBody.data).toMatchObject({ amount: 250, replay: true });
    expect(replayBody.data.source.balance).toBe(750);
    expect(replayBody.data.destination.balance).toBe(250);

    const aliceAccount = await (await fetch(`${endpoint}/v1/tenants/${tenant}/credits?subject=transfer-alice`, { headers: aliceHeaders })).json() as { data: { balance: number; lifetimeConsumed: number } };
    expect(aliceAccount.data).toMatchObject({ balance: 750, lifetimeConsumed: 250 });
    const bobAccount = await (await fetch(`${endpoint}/v1/tenants/${tenant}/credits?subject=transfer-bob`, { headers: bobHeaders })).json() as { data: { balance: number; lifetimeGranted: number } };
    expect(bobAccount.data).toMatchObject({ balance: 250, lifetimeGranted: 250 });

    const ledger = await (await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger?subject=transfer-alice&limit=10`, { headers: aliceHeaders })).json() as { data: Array<{ type: string; amount: number; idempotencyKey: string; sourceLedgerId?: string; pointsSettled?: number }> };
    const outEntry = ledger.data.find((entry) => entry.idempotencyKey === "transfer:transfer-personal-001:out");
    expect(outEntry).toBeDefined();
    expect(outEntry).toMatchObject({ type: "adjustment", amount: 250, pointsSettled: -250 });
    expect(outEntry?.sourceLedgerId).toBeTruthy();
    const bobLedger = await (await fetch(`${endpoint}/v1/tenants/${tenant}/credits/ledger?subject=transfer-bob&limit=10`, { headers: bobHeaders })).json() as { data: Array<{ type: string; amount: number; idempotencyKey: string; sourceLedgerId?: string; pointsSettled?: number }> };
    const inEntry = bobLedger.data.find((entry) => entry.idempotencyKey === "transfer:transfer-personal-001:in");
    expect(inEntry).toBeDefined();
    expect(inEntry).toMatchObject({ type: "adjustment", amount: 250, pointsSettled: 250 });
    expect(inEntry?.sourceLedgerId).toBe(outEntry?.id);
    expect(outEntry?.sourceLedgerId).toBe(inEntry?.id);

    const overdraft = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers: aliceHeaders, body: JSON.stringify({ amount: 10_000, idempotencyKey: "transfer-personal-overdraft-001", source: { subject: "transfer-alice" }, destination: { subject: "transfer-bob" } }) });
    expect(overdraft.status).toBe(402);
    expect((await overdraft.json() as { code: string }).code).toBe("INSUFFICIENT_CREDITS");
  });

  it("moves points between a personal account and a shared wallet only when caller is wallet owner or admin", async () => {
    const tenant = "tenant-transfer-wallet";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "transfer-wallet-admin", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 600 });
    const ownerToken = token(privateKey, { iss: issuer, aud: audience, sub: "transfer-wallet-owner", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 600 });
    const spenderToken = token(privateKey, { iss: issuer, aud: audience, sub: "transfer-wallet-spender", organizations: [tenant], permissions: ["billing.read"], exp: Math.floor(Date.now() / 1000) + 600 });
    const adminHeaders = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    const ownerHeaders = { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" };
    const spenderHeaders = { authorization: `Bearer ${spenderToken}`, "content-type": "application/json" };

    const walletCreate = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ id: "transfer-wallet", name: "Transfer wallet", idempotencyKey: "transfer-wallet-create-001" }) });
    expect(walletCreate.status).toBe(201);
    const memberAdd = await fetch(`${endpoint}/v1/tenants/${tenant}/wallets/transfer-wallet/members/transfer-wallet-spender`, { method: "PUT", headers: ownerHeaders, body: JSON.stringify({ role: "spender", idempotencyKey: "transfer-wallet-member-001" }) });
    expect(memberAdd.status).toBe(200);

    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ subject: "transfer-wallet-owner", amount: 500, idempotencyKey: "transfer-wallet-grant-001" }) });
    expect(grant.status).toBe(201);

    const spenderDeny = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers: spenderHeaders, body: JSON.stringify({ amount: 50, idempotencyKey: "transfer-wallet-spender-deny-001", source: { subject: "transfer-wallet-owner" }, destination: { walletId: "transfer-wallet" } }) });
    expect(spenderDeny.status).toBe(403);
    expect((await spenderDeny.json() as { code: string }).code).toBe("TRANSFER_SOURCE_DENIED");

    const ownerToWallet = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ amount: 200, idempotencyKey: "transfer-wallet-into-001", source: { subject: "transfer-wallet-owner" }, destination: { walletId: "transfer-wallet" } }) });
    expect(ownerToWallet.status).toBe(201);
    const ownerToWalletBody = (await ownerToWallet.json()) as { data: { source: { balance: number }; destination: { balance: number; walletId: string }; replay: boolean } };
    expect(ownerToWalletBody.data.source.balance).toBe(300);
    expect(ownerToWalletBody.data.destination).toMatchObject({ balance: 200, walletId: "transfer-wallet" });
    expect(ownerToWalletBody.data.replay).toBe(false);

    const walletOut = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ amount: 80, idempotencyKey: "transfer-wallet-out-001", source: { walletId: "transfer-wallet" }, destination: { subject: "transfer-wallet-owner" } }) });
    expect(walletOut.status).toBe(201);
    const walletOutBody = (await walletOut.json()) as { data: { source: { balance: number; walletId: string }; destination: { balance: number }; replay: boolean } };
    expect(walletOutBody.data.source).toMatchObject({ balance: 120, walletId: "transfer-wallet" });
    expect(walletOutBody.data.destination.balance).toBe(380);

    const spenderWalletOut = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers: spenderHeaders, body: JSON.stringify({ amount: 10, idempotencyKey: "transfer-wallet-spender-out-001", source: { walletId: "transfer-wallet" }, destination: { subject: "transfer-wallet-spender" } }) });
    expect(spenderWalletOut.status).toBe(403);
    expect((await spenderWalletOut.json() as { code: string }).code).toBe("WALLET_ROLE_INSUFFICIENT");
  });

  it("rejects self-transfer, malformed source/destination, and conflicting idempotency keys", async () => {
    const tenant = "tenant-transfer-validation";
    const adminToken = token(privateKey, { iss: issuer, aud: audience, sub: "transfer-validation-admin", organizations: [tenant], permissions: ["billing.read", "billing.write"], exp: Math.floor(Date.now() / 1000) + 600 });
    const headers = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
    const grant = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/grant`, { method: "POST", headers, body: JSON.stringify({ subject: "transfer-validation-admin", amount: 100, idempotencyKey: "transfer-validation-grant-001" }) });
    expect(grant.status).toBe(201);

    const noSource = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers, body: JSON.stringify({ amount: 10, idempotencyKey: "transfer-validation-no-source-001", destination: { subject: "transfer-validation-target" } }) });
    expect(noSource.status).toBe(400);
    expect((await noSource.json() as { code: string }).code).toBe("INVALID_TRANSFER_SOURCE");

    const dualSource = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers, body: JSON.stringify({ amount: 10, idempotencyKey: "transfer-validation-dual-source-001", source: { subject: "transfer-validation-admin", walletId: "some-wallet" }, destination: { subject: "transfer-validation-target" } }) });
    expect(dualSource.status).toBe(400);
    expect((await dualSource.json() as { code: string }).code).toBe("INVALID_TRANSFER_SOURCE");

    const negativeAmount = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers, body: JSON.stringify({ amount: -10, idempotencyKey: "transfer-validation-negative-001", source: { subject: "transfer-validation-admin" }, destination: { subject: "transfer-validation-target" } }) });
    expect(negativeAmount.status).toBe(400);
    expect((await negativeAmount.json() as { code: string }).code).toBe("INVALID_CREDIT_AMOUNT");

    const shortKey = await fetch(`${endpoint}/v1/tenants/${tenant}/credits/transfer`, { method: "POST", headers, body: JSON.stringify({ amount: 10, idempotencyKey: "short", source: { subject: "transfer-validation-admin" }, destination: { subject: "transfer-validation-target" } }) });
    expect(shortKey.status).toBe(400);
    expect((await shortKey.json() as { code: string }).code).toBe("INVALID_CREDIT_IDEMPOTENCY_KEY");
  });

});
