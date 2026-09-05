/**
 * Real MiniMax session-history load E2E.
 *
 * Validates the user-visible "页面跳转" fix: when the user clicks a
 * historical session in the sidebar, App.tsx must pull persisted session
 * entries from pi and populate the transcript mirror — otherwise the
 * chat panel renders empty until live events arrive (looks like the UI
 * jumped to a blank page).
 *
 * Phases:
 *   1. Bootstrap a real MiniMax session and run a prompt that produces a
 *      known marker in the assistant reply.
 *   2. Wait for pi://complete, then read back the persisted entries via
 *      `agent:session-messages` (the new IPC).
 *   3. Assert at least one user message + one assistant message exist,
 *      the assistant content references the marker, and the entry shape
 *      matches what `sessionEntriesToChatMessages` expects.
 *
 * Required env vars (set by the runner, never hard-coded):
 *   OPENBUDDY_E2E_API_KEY  — MiniMax API key
 *   OPENBUDDY_E2E_BASE_URL — e.g. https://api.minimaxi.com/anthropic
 *   OPENBUDDY_E2E_MODEL_ID — e.g. MiniMax-M3
 */
import { expect, test } from "./_fixtures";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const E2E_API_KEY = process.env.OPENBUDDY_E2E_API_KEY?.trim();
const E2E_BASE_URL = process.env.OPENBUDDY_E2E_BASE_URL?.trim();
const E2E_MODEL_ID = process.env.OPENBUDDY_E2E_MODEL_ID?.trim() ?? "MiniMax-M3";
const E2E_PROVIDER_ID = "minimax_history_roundtrip";
const E2E_WIRE_MODEL_ID = `${E2E_PROVIDER_ID}/${E2E_MODEL_ID}`;

type PiUpdatePayload = {
  sessionId?: string;
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type CaptureBuffer = {
  updates: PiUpdatePayload[];
  completes: Array<{ sessionId?: string }>;
  errors: Array<{ sessionId?: string; error?: string }>;
};

type PiSessionEntry = {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
    timestamp?: number;
  };
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

async function installCapture(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __historyCap?: CaptureBuffer };
    w.__historyCap = { updates: [], completes: [], errors: [] };
    const cap = w.__historyCap!;
    const api = (window as unknown as { api?: { events?: { on: (c: string, h: (p: unknown) => void) => void } } }).api;
    if (!api?.events?.on) throw new Error("renderer bridge events.on is unavailable");
    api.events.on("pi://update", (p) => cap.updates.push(p as PiUpdatePayload));
    api.events.on("pi://complete", (p) => cap.completes.push(p as { sessionId?: string }));
    api.events.on("pi://error", (p) => cap.errors.push(p as { sessionId?: string; error?: string }));
  });
  return async () =>
    page.evaluate(() => {
      const w = window as unknown as { __historyCap?: CaptureBuffer };
      const cap = w.__historyCap;
      if (!cap) throw new Error("capture not installed");
      return { updates: cap.updates.slice(), completes: cap.completes.slice(), errors: cap.errors.slice() };
    });
}

async function bootstrapMinimax(page: import("@playwright/test").Page): Promise<{ sessionId: string; cwd: string }> {
  if (!HAS_CREDS) throw new Error("E2E credentials not configured");
  const cwd = mkdtempSync(join(tmpdir(), "openbuddy-history-e2e-"));
  const sp = await invokeOrReject(page, "agent:providers-save-provider", {
    provider: {
      id: E2E_PROVIDER_ID,
      label: "MiniMax history load",
      providerKind: "custom_anthropic",
      apiKey: E2E_API_KEY,
      baseUrl: E2E_BASE_URL,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  if (!sp.ok) throw new Error(`providers-save-provider failed: ${String(sp.error)}`);
  const sm = await invokeOrReject(page, "agent:providers-save-model", {
    model: { providerId: E2E_PROVIDER_ID, modelId: E2E_MODEL_ID, name: E2E_MODEL_ID, contextWindow: 128000 },
  });
  if (!sm.ok) throw new Error(`providers-save-model failed: ${String(sm.error)}`);
  const ns = await invokeOrReject(page, "agent:new-session", { cwd, modelId: E2E_WIRE_MODEL_ID });
  if (!ns.ok || !ns.value) throw new Error(`agent:new-session failed: ${String(ns.error)}`);
  const sid = (ns.value as { sessionId?: string }).sessionId;
  if (!sid) throw new Error(`new-session returned no sessionId: ${JSON.stringify(ns.value)}`);
  return { sessionId: sid, cwd };
}

async function waitForComplete(readCap: () => Promise<CaptureBuffer>, timeoutMs: number): Promise<CaptureBuffer> {
  const deadline = Date.now() + timeoutMs;
  let last: CaptureBuffer = { updates: [], completes: [], errors: [] };
  while (Date.now() < deadline) {
    last = await readCap();
    if (last.completes.length > 0 || last.errors.length > 0) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return last;
}

test.describe("Session history load (real MiniMax)", () => {
  test.skip(!HAS_CREDS, "MiniMax credentials not configured");

  test("agent:session-messages returns persisted entries that include the user prompt + assistant marker", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });

    // Phase 1 — bootstrap a session and produce a real conversation
    const { sessionId, cwd } = await bootstrapMinimax(page);
    const readCap = await installCapture(page);

    const marker = `HISTORY-MARKER-${Date.now()}`;
    const promptResult = await invokeOrReject(page, "agent:prompt", {
      sessionId,
      text: `MARKER=${marker} 请简短回显这个 marker，不要解释。`,
    });
    expect(promptResult.ok, `agent:prompt failed: ${String(promptResult.error)}`).toBe(true);

    const captured = await waitForComplete(readCap, 120_000);
    expect(captured.errors, `pi://error: ${JSON.stringify(captured.errors)}`).toEqual([]);
    expect(captured.completes.length, `pi://complete never fired; updates=${captured.updates.length}`).toBeGreaterThanOrEqual(1);

    // Sanity — the live stream saw the marker (proves the LLM actually echoed it)
    //
    // Both shapes are accepted on purpose. Live streaming emits `text_delta`;
    // the legacy `text` shape now only comes from history replay
    // (`host-modules/session-store.ts`). This filter used to accept `text`
    // alone and passed only because a coalescer in `ipc/index.ts` re-emitted
    // every delta a second time in that shape — the same duplicate emission
    // that rendered assistant text twice in the transcript. With the duplicate
    // gone, a `text`-only filter collects nothing from a live turn. The
    // persisted-entry assertions further down legitimately stay on `text`,
    // because that is genuinely what replay emits.
    const liveText = captured.updates
      .filter((u) => u.type === "agent_message_chunk")
      .flatMap((u) => u.content ?? [])
      .filter((c) => c.type === "text" || c.type === "text_delta")
      .map((c) => c.text ?? "")
      .join("");
    expect(liveText, `expected live LLM stream to mention marker; got: ${liveText.slice(0, 200)}`).toContain(marker);

    // Phase 2 — loadSession then read persisted entries.
    // This is exactly the path App.tsx takes on a sidebar click after the
    // "页面跳转" fix: piLoadSession → agent:session-messages →
    // sessionEntriesToChatMessages → sessionStore.loadHistoryMessages.
    const loadResult = await invokeOrReject(page, "agent:load-session", { sessionId, cwd });
    expect(loadResult.ok, `agent:load-session failed: ${String(loadResult.error)}`).toBe(true);

    const entries = await invoke<PiSessionEntry[]>(page, "agent:session-messages", { sessionId });
    expect(Array.isArray(entries), `agent:session-messages did not return an array: ${JSON.stringify(entries).slice(0, 300)}`).toBe(true);
    expect(entries.length, `expected persisted entries; got 0`).toBeGreaterThanOrEqual(2);

    // Phase 3 — assert the entries contain user + assistant with the marker.
    const messages = entries.filter((e) => e.type === "message" && e.message);
    expect(messages.length, `expected at least one message entry; got ${messages.length}`).toBeGreaterThanOrEqual(2);

    const userMessage = messages.find((m) => m.message?.role === "user");
    const assistantMessage = messages.find((m) => m.message?.role === "assistant");
    expect(userMessage, `no user message entry found; roles=${messages.map((m) => m.message?.role).join(",")}`).toBeTruthy();
    expect(assistantMessage, `no assistant message entry found; roles=${messages.map((m) => m.message?.role).join(",")}`).toBeTruthy();

    const userText = (userMessage!.message!.content ?? [])
      .filter((c) => c.type === "text" && typeof (c as { text?: string }).text === "string")
      .map((c) => (c as { text: string }).text)
      .join("");
    expect(userText, `user message did not contain marker; got: ${userText.slice(0, 200)}`).toContain(marker);

    const assistantText = (assistantMessage!.message!.content ?? [])
      .filter((c) => c.type === "text" && typeof (c as { text?: string }).text === "string")
      .map((c) => (c as { text: string }).text)
      .join("");
    expect(assistantText, `assistant message did not contain marker; got: ${assistantText.slice(0, 200)}`).toContain(marker);
  });

  test("agent:session-messages returns an empty array for a fresh session (no transcript yet)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const { sessionId, cwd } = await bootstrapMinimax(page);

    const loadResult = await invokeOrReject(page, "agent:load-session", { sessionId, cwd });
    expect(loadResult.ok, `agent:load-session failed: ${String(loadResult.error)}`).toBe(true);

    const entries = await invoke<PiSessionEntry[]>(page, "agent:session-messages", { sessionId });
    expect(Array.isArray(entries)).toBe(true);
    // A brand-new session has no message entries — only the session header.
    const messages = entries.filter((e) => e.type === "message");
    expect(messages.length, `fresh session should have 0 message entries; got ${messages.length}: ${JSON.stringify(entries.slice(0, 3))}`).toBe(0);
  });
});
