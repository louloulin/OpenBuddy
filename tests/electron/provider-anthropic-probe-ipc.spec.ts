/**
 * provider-anthropic-probe-ipc.spec.ts — R4.2 — Real Electron + Playwright e2e
 * test for the Anthropic-Messages-compatible branch of `agent:providers-test`
 * and `agent:providers-fetch-models`.
 *
 * ## Why this exists separately from `provider-test-ipc.spec.ts`
 *
 * The original Phase 2 spec uses a local mock that answers `GET /models`,
 * which is the OpenAI-compatible branch. Anthropic-Messages-compatible
 * upstreams (Anthropic, custom_anthropic, minimax_cn, and the built-in
 * MiniMax provider at `https://api.minimaxi.com/anthropic`) do NOT expose a
 * `/models` catalog — `GET /anthropic/models` returns 404 even with a valid
 * key, as does `GET /v1/models`. The chat endpoint, by contrast, is the
 * authoritative connectivity probe: it carries the same auth shape, the
 * same `anthropic-version` header, and the same payload envelope the
 * `agent:prompt` flow will eventually use.
 *
 * The IPC handler in `electron/main/ipc/providers.ts` therefore probes
 * `POST /v1/messages` for Anthropic-compatible providers and falls back to
 * `GET /models` for OpenAI-compatible ones. A 400 from the chat endpoint
 * with `error.type === "invalid_request_error"` is treated as "reachable
 * + authenticated, but the synthetic probe payload failed upstream-side
 * validation" — i.e. the connection is healthy from openbuddy's perspective.
 *
 * ## What this asserts
 *
 *   - Real Electron boots, the renderer mounts, the preload bridge is up.
 *   - `agent:providers-test` against a mock Anthropic-Messages server that
 *     returns 200 returns `{ status: "healthy", probe: "messages" }`.
 *   - `agent:providers-test` against a mock Anthropic-Messages server that
 *     returns 400 + `invalid_request_error` returns
 *     `{ status: "healthy", probe: "messages" }` (NOT degraded — the auth
 *     and transport work; the payload shape was wrong but that is the
 *     probe's fault, not the upstream's).
 *   - `agent:providers-test` against a mock Anthropic-Messages server that
 *     returns 401 returns `{ status: "degraded", errorCode: "401" }`.
 *   - `agent:providers-fetch-models` against the same Anthropic-Messages
 *     mock returns `[]` instead of throwing — discovery of the catalog
 *     is best-effort, and Anthropic-compatible upstreams may legitimately
 *     not expose one.
 */
import { expect, test } from "./_fixtures";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

test.describe("agent:providers-test — Anthropic-Messages probe branch", () => {
  let mockServer: Server | null = null;
  let mockBaseUrl = "";
  let nextStatus = 200;
  let nextErrorType: "invalid_request_error" | null = null;
  let seenAuthHeader: string | null = null;
  let seenPath: string | null = null;
  let seenMethod: string | null = null;
  let seenBody: unknown = null;

  test.beforeAll(async () => {
    mockServer = createServer((req, res) => {
      seenAuthHeader = (req.headers["x-api-key"] as string | undefined) ?? null;
      seenPath = req.url ?? null;
      seenMethod = req.method ?? null;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (raw.length > 0) {
          try { seenBody = JSON.parse(raw); } catch { seenBody = raw; }
        }
        if (nextStatus >= 400) {
          res.writeHead(nextStatus, { "content-type": "application/json" });
          const errorType = nextErrorType ?? "api_error";
          res.end(JSON.stringify({
            type: "error",
            error: { type: errorType, message: `mock ${nextStatus}` },
          }));
          return;
        }
        res.writeHead(nextStatus, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: "OK" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }));
      });
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

  test.beforeEach(() => {
    nextStatus = 200;
    nextErrorType = null;
    seenAuthHeader = null;
    seenPath = null;
    seenMethod = null;
    seenBody = null;
  });

  test("AC-4.2.1: 200 from /v1/messages returns healthy with probe='messages'", async ({ page }) => {
    await page.waitForFunction(() => Boolean((window as unknown as { api?: { invoke?: unknown } }).api?.invoke));
    nextStatus = 200;
    const snapshot = await page.evaluate(
      async ({ baseUrl }: { baseUrl: string }) => {
        const w = window as unknown as { api: { invoke: (ch: string, args?: unknown) => Promise<unknown> } };
        return await w.api.invoke("agent:providers-test", {
          baseUrl,
          apiKey: "test-key",
          providerKind: "custom_anthropic",
        });
      },
      { baseUrl: mockBaseUrl },
    );
    expect(snapshot).toMatchObject({
      status: "healthy",
      httpStatus: 200,
      probe: "messages",
    });
    const s = snapshot as { latencyMs: number; checkedAt: string };
    expect(s.latencyMs).toBeGreaterThan(0);
    expect(s.checkedAt).toBeTruthy();
    // The probe must hit POST /v1/messages with the Anthropic-Messages
    // auth shape, not the legacy GET /models path.
    expect(seenMethod).toBe("POST");
    expect(seenPath).toBe("/v1/messages");
    expect(seenAuthHeader).toBe("test-key");
    expect((seenBody as { model?: string; max_tokens?: number; messages?: unknown[] } | null)?.model).toBe("claude-haiku-4-5");
    expect((seenBody as { max_tokens?: number } | null)?.max_tokens).toBe(1);
  });

  test("AC-4.2.2: 400 invalid_request_error still reports healthy — auth + transport work", async ({ page }) => {
    await page.waitForFunction(() => Boolean((window as unknown as { api?: { invoke?: unknown } }).api?.invoke));
    nextStatus = 400;
    nextErrorType = "invalid_request_error";
    const snapshot = await page.evaluate(
      async ({ baseUrl }: { baseUrl: string }) => {
        const w = window as unknown as { api: { invoke: (ch: string, args?: unknown) => Promise<unknown> } };
        return await w.api.invoke("agent:providers-test", {
          baseUrl,
          apiKey: "test-key",
          providerKind: "custom_anthropic",
        });
      },
      { baseUrl: mockBaseUrl },
    );
    expect(snapshot).toMatchObject({
      status: "healthy",
      httpStatus: 400,
      probe: "messages",
    });
    const s = snapshot as { errorCode?: string };
    expect(s.errorCode).toBeUndefined();
  });

  test("AC-4.2.3: 401 reports degraded with errorCode='401'", async ({ page }) => {
    await page.waitForFunction(() => Boolean((window as unknown as { api?: { invoke?: unknown } }).api?.invoke));
    nextStatus = 401;
    const snapshot = await page.evaluate(
      async ({ baseUrl }: { baseUrl: string }) => {
        const w = window as unknown as { api: { invoke: (ch: string, args?: unknown) => Promise<unknown> } };
        return await w.api.invoke("agent:providers-test", {
          baseUrl,
          apiKey: "wrong-key",
          providerKind: "custom_anthropic",
        });
      },
      { baseUrl: mockBaseUrl },
    );
    expect(snapshot).toMatchObject({
      status: "degraded",
      httpStatus: 401,
      errorCode: "401",
    });
  });

  test("AC-4.2.4: fetch-models against an Anthropic-Messages upstream returns [] instead of throwing", async ({ page }) => {
    await page.waitForFunction(() => Boolean((window as unknown as { api?: { invoke?: unknown } }).api?.invoke));
    // Mock returns 404 for the count_tokens probe — the catch path.
    nextStatus = 404;
    const result = await page.evaluate(
      async ({ baseUrl }: { baseUrl: string }) => {
        const w = window as unknown as { api: { invoke: (ch: string, args?: unknown) => Promise<unknown> } };
        return await w.api.invoke("agent:providers-fetch-models", {
          baseUrl,
          apiKey: "test-key",
          providerKind: "custom_anthropic",
        });
      },
      { baseUrl: mockBaseUrl },
    );
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBe(0);
  });
});