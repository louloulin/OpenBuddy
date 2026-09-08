/**
 * provider-test-ipc.spec.ts — R2.4 — Real Electron + Playwright e2e test
 * for the Phase 2 `agent:providers-test` IPC handler.
 *
 * Spawns the built Electron app via the `_fixtures` harness, then
 * drives the renderer to invoke `agent:providers-test` through the
 * preload bridge exactly the way the new ProviderEditor does. This
 * proves the full chain works in production:
 *
 *   renderer (page.evaluate) → preload bridge → IPC → main handler →
 *   fetch(/v1/models) → response → renderer
 *
 * The handler contacts a real mock server spun up by the spec. We
 * assert the snapshot shape matches what `ProviderHealthBadge` expects
 * and what `ProviderEditor` would render.
 */
import { expect, test } from "./_fixtures";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

test.describe("agent:providers-test — real Electron e2e", () => {
  let mockServer: Server | null = null;
  let mockBaseUrl = "";
  let forceUnauthorizedNext = false;
  const VALID_KEY = "e2e-real-electron-key";

  test.beforeAll(async () => {
    mockServer = createServer((req, res) => {
      const auth = req.headers["authorization"] ?? "";
      if (forceUnauthorizedNext || auth !== `Bearer ${VALID_KEY}`) {
        forceUnauthorizedNext = false;
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
        return;
      }
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          object: "list",
          data: [
            { id: "e2e-model-a", owned_by: "e2e" },
            { id: "e2e-model-b", owned_by: "e2e" },
          ],
        }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolveListen) => {
      mockServer!.listen(0, "127.0.0.1", () => resolveListen());
    });
    const info = mockServer.address() as AddressInfo;
    mockBaseUrl = `http://127.0.0.1:${info.port}`;
  });

  test.afterAll(async () => {
    if (mockServer) await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
  });

  test("AC-2.2: happy path through the preload bridge returns a healthy snapshot", async ({ electronApp, page }) => {
    // Wait for the renderer's preload bridge to be ready. The harness
    // exposes window.openbuddy.invoke — poll for it.
    await page.waitForFunction(() => Boolean((window as unknown as { api?: { invoke?: unknown } }).api?.invoke));

    const snapshot = await page.evaluate(
      async ({ baseUrl, apiKey, providerKind }: { baseUrl: string; apiKey: string; providerKind: string }) => {
        const w = window as unknown as { api: { invoke: (ch: string, args?: unknown) => Promise<unknown> } };
        return await w.api.invoke("agent:providers-test", { baseUrl, apiKey, providerKind });
      },
      { baseUrl: mockBaseUrl, apiKey: VALID_KEY, providerKind: "openai" },
    );

    expect(snapshot).toMatchObject({
      status: "healthy",
      httpStatus: 200,
      modelsCount: 2,
    });
    const s = snapshot as { latencyMs: number; checkedAt: string; errorCode?: string };
    expect(typeof s.latencyMs).toBe("number");
    expect(s.latencyMs).toBeGreaterThan(0);
    expect(typeof s.checkedAt).toBe("string");
    expect(s.errorCode).toBeUndefined();
  });

  test("AC-2.3: 401 from real HTTP returns degraded + errorCode='401'", async ({ electronApp, page }) => {
    await page.waitForFunction(() => Boolean((window as unknown as { api?: { invoke?: unknown } }).api?.invoke));

    const snapshot = await page.evaluate(
      async ({ baseUrl, apiKey, providerKind }: { baseUrl: string; apiKey: string; providerKind: string }) => {
        const w = window as unknown as { api: { invoke: (ch: string, args?: unknown) => Promise<unknown> } };
        return await w.api.invoke("agent:providers-test", { baseUrl, apiKey, providerKind });
      },
      { baseUrl: mockBaseUrl, apiKey: "definitely-wrong-key", providerKind: "openai" },
    );

    expect(snapshot).toMatchObject({
      status: "degraded",
      httpStatus: 401,
      errorCode: "401",
    });
  });

  test("AC-2.3: unreachable host returns ENOTFOUND-style error from the real IPC", async ({ electronApp, page }) => {
    await page.waitForFunction(() => Boolean((window as unknown as { api?: { invoke?: unknown } }).api?.invoke));

    const snapshot = await page.evaluate(
      async ({ providerKind }: { providerKind: string }) => {
        const w = window as unknown as { api: { invoke: (ch: string, args?: unknown) => Promise<unknown> } };
        return await w.api.invoke("agent:providers-test", {
          baseUrl: "http://does-not-exist.invalid:9999",
          apiKey: "x",
          providerKind,
        });
      },
      { providerKind: "openai" },
    );

    // The IPC handler's catch branch maps to unreachable with the OS
    // error code. Real DNS lookups against the .invalid TLD can resolve
    // to a sinkhole IP that resets the connection, so ECONNRESET is the
    // most common observed value in CI; on bare DNS-failure systems the
    // code is ENOTFOUND / EAI_AGAIN. Any non-empty errorCode is a pass —
    // suggestionForError renders the appropriate hint based on the
    // returned code.
    expect(snapshot).toMatchObject({ status: "unreachable" });
    const s = snapshot as { errorCode?: string; errorMessage?: string };
    expect(s.errorCode).toBeDefined();
    expect(typeof s.errorCode).toBe("string");
    expect(s.errorCode!.length).toBeGreaterThan(0);
    // Sanity: the suggested list covers every documented Node DNS /
    // network error we have observed in real environments.
    // Real Electron's fetch (undici) reports network failures with a
    // wider set of codes than the legacy Node DNS errors. We accept
    // any non-empty code so the test is portable across environments
    // (CI's DNS sinkhole vs. local strict DNS) — the IPC handler's
    // contract is "give me a code", not "give me a specific code".
    const acceptableNetworkErrors = new Set([
      "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET",
      "ETIMEDOUT", "EPIPE", "EHOSTUNREACH", "ENETUNREACH",
      "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT", "fetch failed", "timeout",
    ]);
    expect(
      acceptableNetworkErrors.has(s.errorCode!) || s.errorCode!.startsWith("UND_"),
      `unexpected errorCode: ${s.errorCode}`,
    ).toBe(true);
  });
});
