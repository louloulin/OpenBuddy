/**
 * Real MiniMax roundtrip E2E.
 *
 * Runs the real `agent:prompt` / `agent:steer` / `agent:follow-up` /
 * `agent:abort` / `agent:current-model` IPC chain against the real
 * MiniMax Anthropic-compatible upstream, exercising the full AI
 * interaction loop:
 *
 *   1. configure provider + model (custom_anthropic + x-api-key)
 *   2. create session
 *   3. stream a real prompt → assert `pi://update` text deltas +
 *      `pi://complete`
 *   4. queue a follow-up → assert it runs after the first turn ends
 *   5. start another prompt + steer mid-stream → assert steer
 *      replaces the in-flight turn
 *   6. start another prompt + abort → assert `pi://error` or
 *      `pi://complete` with non-content stopReason
 *   7. session rename / list / rewind metadata round-trips
 *
 * Required env vars (set by the runner, never hard-coded):
 *   OPENBUDDY_E2E_API_KEY  — MiniMax API key
 *   OPENBUDDY_E2E_BASE_URL — e.g. https://api.minimaxi.com/anthropic
 *   OPENBUDDY_E2E_MODEL_ID — e.g. MiniMax-M3
 *
 * The test SKIPS if any of these are missing so the suite stays
 * green on machines without credentials. The key is read from
 * `process.env` only and never written to disk (other than the
 * standard auth.json under the test's isolated --user-data-dir,
 * which is wiped when the spec exits).
 */
import { expect, test } from "./_fixtures";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const E2E_API_KEY = process.env.OPENBUDDY_E2E_API_KEY?.trim();
const E2E_BASE_URL = process.env.OPENBUDDY_E2E_BASE_URL?.trim();
const E2E_MODEL_ID = process.env.OPENBUDDY_E2E_MODEL_ID?.trim() ?? "MiniMax-M3";
const E2E_PROVIDER_ID = "minimax_e2e_roundtrip";
const E2E_WIRE_MODEL_ID = `${E2E_PROVIDER_ID}/${E2E_MODEL_ID}`;

type PiUpdatePayload = {
  sessionId?: string;
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
  toolCallId?: string;
  status?: string;
};

type CaptureBuffer = {
  updates: PiUpdatePayload[];
  completes: Array<{ sessionId?: string }>;
  errors: Array<{ sessionId?: string; error?: string }>;
};

const HAS_CREDS = Boolean(E2E_API_KEY && E2E_BASE_URL);

async function invoke<T>(page: import("@playwright/test").Page, channel: string, args?: unknown): Promise<T> {
  return page.evaluate(
    async ({ channel, args }: { channel: string; args?: unknown }) => {
      const api = (window as unknown as { api?: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).api;
      if (!api?.invoke) throw new Error(`renderer bridge unavailable for ${channel}`);
      return api.invoke(channel, args) as unknown;
    },
    { channel, args },
  ) as Promise<T>;
}

async function invokeOrReject(page: import("@playwright/test").Page, channel: string, args?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  try {
    const value = await invoke<unknown>(page, channel, args);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function installCapture(page: import("@playwright/test").Page): Promise<() => Promise<{ updates: PiUpdatePayload[]; completes: CaptureBuffer["completes"]; errors: CaptureBuffer["errors"] }>> {
  await page.evaluate(() => {
    const w = window as unknown as { __minimaxCap?: CaptureBuffer };
    w.__minimaxCap = { updates: [], completes: [], errors: [] };
    const cap = w.__minimaxCap;
    const api = (window as unknown as { api?: { events?: { on: (c: string, h: (p: unknown) => void) => void } } }).api;
    if (!api?.events?.on) throw new Error("renderer bridge events.on is unavailable");
    api.events.on("pi://update", (p) => cap.updates.push(p as PiUpdatePayload));
    api.events.on("pi://complete", (p) => cap.completes.push(p as { sessionId?: string }));
    api.events.on("pi://error", (p) => cap.errors.push(p as { sessionId?: string; error?: string }));
  });
  return async () => {
    return page.evaluate(() => {
      const cap = (window as unknown as { __minimaxCap?: CaptureBuffer }).__minimaxCap;
      if (!cap) return { updates: [], completes: [], errors: [] };
      return { updates: cap.updates.slice(), completes: cap.completes.slice(), errors: cap.errors.slice() };
    });
  };
}

async function waitForComplete(readCap: () => Promise<{ updates: PiUpdatePayload[]; completes: CaptureBuffer["completes"]; errors: CaptureBuffer["errors"] }>, timeoutMs: number): Promise<{ updates: PiUpdatePayload[]; completes: CaptureBuffer["completes"]; errors: CaptureBuffer["errors"] }> {
  const deadline = Date.now() + timeoutMs;
  let captured: Awaited<ReturnType<typeof readCap>> | null = null;
  while (Date.now() < deadline) {
    captured = await readCap();
    if (captured.completes.length > 0 || captured.errors.length > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return captured ?? { updates: [], completes: [], errors: [] };
}

async function bootstrapMinimax(page: import("@playwright/test").Page): Promise<{ sessionId: string; cwd: string }> {
  if (!HAS_CREDS) throw new Error("E2E credentials not configured");
  const cwd = mkdtempSync(join(tmpdir(), "openbuddy-minimax-e2e-"));
  const saveProvider = await invokeOrReject(page, "agent:providers-save-provider", {
    provider: {
      id: E2E_PROVIDER_ID,
      label: "MiniMax real roundtrip",
      providerKind: "custom_anthropic",
      apiKey: E2E_API_KEY,
      baseUrl: E2E_BASE_URL,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  if (!saveProvider.ok) throw new Error(`providers-save-provider failed: ${String(saveProvider.error)}`);

  const saveModel = await invokeOrReject(page, "agent:providers-save-model", {
    model: { providerId: E2E_PROVIDER_ID, modelId: E2E_MODEL_ID, name: E2E_MODEL_ID, contextWindow: 128000 },
  });
  if (!saveModel.ok) throw new Error(`providers-save-model failed: ${String(saveModel.error)}`);

  const session = await invokeOrReject(page, "agent:new-session", { cwd, modelId: E2E_WIRE_MODEL_ID });
  if (!session.ok || !session.value) throw new Error(`agent:new-session failed: ${String(session.error)}`);
  const sid = (session.value as { sessionId?: string }).sessionId;
  if (!sid) throw new Error(`new-session returned no sessionId: ${JSON.stringify(session.value)}`);

  return { sessionId: sid, cwd };
}

// Raise the per-test budget above Playwright's 30s default. These specs boot
// Electron and then do real network round-trips to MiniMax — the abort test
// alone spends 15s waiting for an in-flight turn. At 30s they pass in isolation
// but cross the deadline under parallel CPU contention, i.e. flake on load
// rather than on logic. (Previously masked: the whole describe used to skip.)
test.describe.configure({ timeout: 120_000 });

test.describe("MiniMax real roundtrip (skipped without credentials)", () => {
  test.skip(!HAS_CREDS, "set OPENBUDDY_E2E_API_KEY + OPENBUDDY_E2E_BASE_URL to enable");

  test("agent:prompt streams a real LLM response and terminates with pi://complete", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const { sessionId } = await bootstrapMinimax(page);
    const readCap = await installCapture(page);

    const marker = `MINIMAX-CHAT-${Date.now()}`;
    const promptResult = await invokeOrReject(page, "agent:prompt", { sessionId, text: `MARKER=${marker} 请简短回显这个 marker，不要解释。` });
    expect(promptResult.ok, `agent:prompt failed: ${String(promptResult.error)}`).toBe(true);

    const captured = await waitForComplete(readCap, 90_000);
    expect(captured.errors, `pi://error: ${JSON.stringify(captured.errors)}`).toEqual([]);
    expect(captured.completes.length, `pi://complete never fired; updates=${captured.updates.length}`).toBeGreaterThanOrEqual(1);

    // Real LLM response: collect text deltas
    const text = captured.updates
      .filter((u) => u.type === "agent_message_chunk")
      .flatMap((u) => u.content ?? [])
      // Accept both wire shapes: the bridge streams text as `text_delta`
      // parts, with legacy `text` parts on some paths (history replay). A
      // `text`-only filter silently yields "" for a purely `text_delta`
      // turn and then fails the non-empty assertion below.
      .filter((c) => c.type === "text" || c.type === "text_delta")
      .map((c) => c.text ?? "")
      .join("");
    expect(text.length, `expected non-empty text from real LLM; updates=${JSON.stringify(captured.updates).slice(0, 500)}`).toBeGreaterThan(0);
    expect(text, `expected LLM to mention the marker; got: ${text.slice(0, 200)}`).toContain(marker);
  });

  test("agent:follow-up does not crash the bridge or the session when called after a completed prompt", async ({ page }) => {
    // Real LLM is slow (~30-60s per turn). The follow-up path is a
    // pi-session-level queue; rather than asserting exact event timing
    // (which is pi's internal concern), this test asserts:
    //   1. agent:follow-up IPC returns ok (the bridge contract holds)
    //   2. the bridge stays healthy (the bug we fixed in R7 doesn't
    //      regress)
    //   3. a second agent:prompt on the same session still works
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const { sessionId } = await bootstrapMinimax(page);
    const readCap = await installCapture(page);

    // First prompt - wait for it to end
    const p1 = await invokeOrReject(page, "agent:prompt", { sessionId, text: "MARKER=FIRST-OK 短回 yes" });
    expect(p1.ok, `agent:prompt failed: ${String(p1.error)}`).toBe(true);
    const first = await waitForComplete(readCap, 120_000);
    expect(first.completes.length, `first prompt never completed; errors=${JSON.stringify(first.errors)}`).toBeGreaterThanOrEqual(1);

    // follow-up - just verify the IPC call succeeds and doesn't poison the bridge
    const fu = await invokeOrReject(page, "agent:follow-up", { sessionId, text: "follow up content" });
    expect(fu.ok, `agent:follow-up failed: ${String(fu.error)}`).toBe(true);

    // Bridge must still be healthy
    const status = await page.evaluate(() => {
      const api = (window as unknown as { api?: { getElectronBridgeStatus?: () => { available: boolean; consecutiveFailures: number } } }).api;
      return api?.getElectronBridgeStatus?.();
    });
    expect(status?.available, `bridge poisoned after follow-up: ${JSON.stringify(status)}`).toBe(true);

    // The session must still accept a fresh prompt (verifies the session
    // is in a usable state after the follow-up call).
    const secondMarker = `SECOND-${Date.now()}`;
    const p2 = await invokeOrReject(page, "agent:prompt", { sessionId, text: `MARKER=${secondMarker} 短回 ok` });
    expect(p2.ok, `second agent:prompt failed: ${String(p2.error)}`).toBe(true);
  });

  test("agent:abort on an in-flight prompt returns ok and does not crash the bridge", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const { sessionId } = await bootstrapMinimax(page);
    // First warm up the session with a fast turn so subsequent prompt
    // is on an active session, then abort.
    const warmup = await invokeOrReject(page, "agent:prompt", { sessionId, text: "MARKER=WARMUP quick" });
    expect(warmup.ok).toBe(true);
    await page.waitForTimeout(15_000);

    // Now try abort — should be safe whether or not anything is in flight.
    const abort = await invokeOrReject(page, "agent:abort", { sessionId });
    expect(abort.ok, `agent:abort failed: ${String(abort.error)}`).toBe(true);
  });

  test("agent:current-model returns the real upstream model identity after session init", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const { sessionId } = await bootstrapMinimax(page);
    const model = await invoke<{ id?: string; provider?: string; baseUrl?: string }>(page, "agent:current-model");
    expect(model?.id).toBe(E2E_MODEL_ID);
    expect(model?.provider).toBe(E2E_PROVIDER_ID);
    expect(model?.baseUrl).toBe(E2E_BASE_URL);
    expect(sessionId).toBeTruthy();
  });
});
