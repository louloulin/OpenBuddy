/**
 * P0-3 — Real chat E2E via the Anthropic echo provider.
 *
 * Boots a real Electron with a locally-spawned echo Anthropic-Messages
 * server (`evals/node/echo/anthropic-echo-provider.mjs`) listening on
 * 127.0.0.1:8787. The server is spawned via `child_process.spawn` in the
 * test's worker (NOT via a separate shell process) so it stays alive for
 * the duration of the suite — exec_command shells tend to kill detached
 * child processes on exit.
 *
 * Each test then wires the provider + model via `agent:providers-save-provider`
 * and `agent:providers-save-model`, creates a session with `agent:new-session`
 * (which auto-activates the model), and sends a prompt with `agent:prompt`.
 *
 * The renderer exposes `window.api.events.on(channel, handler)` for
 * `pi://update`, `pi://complete`, and `pi://error` channels. The test
 * captures these into a renderer-side array, then reads the buffer via
 * `page.evaluate()` to assert streaming + completion semantics.
 *
 * Each test launches a fresh Electron (via the `--user-data-dir` fixture)
 * so profile state, plugin loaders, and event logs are isolated.
 */
import { expect, test } from "./_fixtures";
import {
  ECHO_MODEL_ID,
  ECHO_PROVIDER_ID,
  ECHO_WIRE_MODEL_ID,
  bootstrapEcho,
  collectText,
  installCapture,
  invoke,
  invokeOrReject,
  startEchoServer,
  stopEchoServer,
  type EchoServer,
  type PiUpdatePayload,
} from "./_echo-harness";

test.describe("chat flow with echo provider", () => {
  let echo: EchoServer | null = null;
  /** Resolved in `beforeAll` from the server's own stdout announcement. */
  let echoBase = "";

  test.beforeAll(async () => {
    echo = await startEchoServer("chat-flow-echo");
    echoBase = echo.baseUrl;
  });

  test.afterAll(async () => {
    await stopEchoServer(echo);
    echo = null;
  });

  test("providers-save-provider + save-model + new-session wire the echo upstream", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const { sessionId } = await bootstrapEcho(page, echoBase);
    expect(sessionId).toBeTruthy();
  });

  test("agent:prompt streams pi://update chunks and terminates with pi://complete", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const { sessionId } = await bootstrapEcho(page, echoBase);
    const readCapture = await installCapture(page);

    const marker = "OPENBUDDY-CHAT-FLOW";
    const promptResult = await invokeOrReject(page, "agent:prompt", { sessionId, text: `MARKER=${marker} please echo` });
    expect(promptResult.ok, `agent:prompt failed: ${String(promptResult.value)}`).toBe(true);

    // Wait for the turn to stream AND finish — echo server is fast, 15s cap.
    //
    // Breaking on `completes.length > 0` alone is racy. `pi://complete` is
    // over-emitted by the main process: `handle-session-event.ts:442` maps
    // three separate pi lifecycle events (`turn_end`, `agent_end`,
    // `agent_settled`) onto it, and `host-modules/session-store.ts:137,150,162`
    // emits one per content part while replaying history. A complete that
    // belongs to session bootstrap rather than to our prompt can therefore
    // land before the first text chunk, and this loop would exit with
    // `updates: []` — which is exactly how this test flaked (observed 1 fail /
    // 9 pass under `--repeat-each=2`).
    //
    // Requiring at least one update alongside the complete pins the condition
    // we actually care about: the turn produced content and then terminated.
    const deadline = Date.now() + 15_000;
    let captured: Awaited<ReturnType<typeof readCapture>> | null = null;
    while (Date.now() < deadline) {
      captured = await readCapture();
      if (captured.errors.length > 0) break;
      if (captured.completes.length > 0 && collectText(captured.updates).length > 0) break;
      await page.waitForTimeout(200);
    }
    expect(captured).not.toBeNull();
    expect(captured!.errors, `unexpected pi://error: ${JSON.stringify(captured!.errors)}`).toEqual([]);
    expect(captured!.completes.length, `pi://complete never fired; saw updates=${captured!.updates.length}`).toBeGreaterThanOrEqual(1);

    const text = collectText(captured!.updates);
    expect(text.length, `expected at least one text chunk, got ${JSON.stringify(captured!.updates)}`).toBeGreaterThan(0);
    expect(text, `expected echo response to contain marker; updates=${JSON.stringify(captured!.updates)}`).toContain(marker);
  });

  test("agent:abort returns ok even when no prompt is in flight (idempotent)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const { sessionId } = await bootstrapEcho(page, echoBase);

    const abortResult = await invokeOrReject(page, "agent:abort", { sessionId });
    expect(abortResult.ok, `agent:abort failed: ${String(abortResult.value)}`).toBe(true);
    const payload = abortResult.value as { ok?: boolean };
    expect(payload?.ok).toBe(true);
  });

  test("agent:steer and agent:follow-up do not error when no prompt is queued", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const { sessionId } = await bootstrapEcho(page, echoBase);

    // steer/follow-up with empty queue — the IPC must accept the call
    // (the agent may reject internally, but the bridge must not crash).
    const steer = await invokeOrReject(page, "agent:steer", { sessionId, text: "steer hello" });
    expect(steer.ok, `agent:steer crashed the bridge: ${String(steer.value)}`).toBe(true);

    const followUp = await invokeOrReject(page, "agent:follow-up", { sessionId, text: "follow up hello" });
    expect(followUp.ok, `agent:follow-up crashed the bridge: ${String(followUp.value)}`).toBe(true);
  });

  test("provider-save-provider rejects invalid baseUrl with a structured error", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const result = await invokeOrReject(page, "agent:providers-save-provider", {
      provider: {
        id: "invalid_provider",
        providerKind: "custom_anthropic",
        apiKey: "k",
        baseUrl: "not-a-url",
        apiBackend: "messages",
        authScheme: "x_api_key",
      },
    });
    expect(result.ok).toBe(false);
    expect(String(result.value).toLowerCase()).toMatch(/url/);
  });
});
