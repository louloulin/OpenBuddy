/**
 * Regression test for the bridge-poisoning P0 bug discovered during
 * chat/session lifecycle audit (R7).
 *
 * Bug summary: `electron/preload/index.ts` previously called
 * `recordBridgeFailure` for EVERY `ipcRenderer.invoke` rejection and
 * marked `bridgeHealth.available = false` on the first failure
 * (`consecutiveFailures >= 1`). Since `ipcMain.handle` handlers throw
 * structured errors for routine business failures (e.g. "Pi session
 * not found"), a single misclick on a non-existent session in the UI
 * permanently killed all subsequent IPC until the renderer was
 * reloaded.
 *
 * Fix: only mark unavailable when the error is a real bridge failure
 * (per `isElectronBridgeUnavailable`) AND the failure threshold (3
 * consecutive) is hit. A single successful `invoke` from any channel
 * recovers the bridge.
 */
import { expect, test } from "./_fixtures";

async function invokeOrReject(page: import("@playwright/test").Page, channel: string, args?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string; isBridgeUnavailable: boolean }> {
  return page.evaluate(
    async ({ channel, args }: { channel: string; args?: unknown }) => {
      const api = (window as unknown as { api?: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).api;
      if (!api?.invoke) throw new Error("renderer bridge unavailable");
      try {
        const value = await api.invoke(channel, args);
        return { ok: true, value, isBridgeUnavailable: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message, isBridgeUnavailable: /electron bridge unavailable/i.test(message) };
      }
    },
    { channel, args },
  );
}

async function bridgeStatus(page: import("@playwright/test").Page): Promise<{ available: boolean; consecutiveFailures: number; lastErrorMessage: string | null }> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      api?: { getElectronBridgeStatus?: () => { available: boolean; consecutiveFailures: number; lastErrorMessage: string | null } };
    }).api;
    return api?.getElectronBridgeStatus?.() ?? { available: true, consecutiveFailures: 0, lastErrorMessage: null };
  });
}

test.describe("bridge poisoning regression (R7)", () => {
  test("agent:load-session with a non-existent id returns a structured business error WITHOUT poisoning the bridge", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const before = await bridgeStatus(page);
    expect(before.available).toBe(true);

    // Trigger a business failure.
    const fail = await invokeOrReject(page, "agent:load-session", { sessionId: "definitely-does-not-exist-xyz", cwd: "/tmp" });
    expect(fail.ok).toBe(false);
    // The error message is the structured business error — NOT prefixed with
    // "electron bridge unavailable", which is the marker for real bridge failures.
    expect(fail.isBridgeUnavailable, `bridge should NOT be unavailable after a business error; got: ${fail.error}`).toBe(false);
    expect(fail.error ?? "").toMatch(/session not found|not loaded/i);

    // The bridge must still be available for subsequent calls.
    const after = await bridgeStatus(page);
    expect(after.available, `bridge poisoned after a business error; consecutiveFailures=${after.consecutiveFailures}, lastError=${after.lastErrorMessage}`).toBe(true);
  });

  test("multiple business errors do NOT poison the bridge (threshold = 3 real-bridge failures only)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    // Fire 5 business errors in a row.
    for (let i = 0; i < 5; i++) {
      const r = await invokeOrReject(page, "agent:load-session", { sessionId: `nonexistent-${i}`, cwd: "/tmp" });
      expect(r.ok).toBe(false);
      expect(r.isBridgeUnavailable, `call #${i + 1} was marked as bridge unavailable; error: ${r.error}`).toBe(false);
    }
    // Bridge must STILL be available — business errors should never poison.
    const after = await bridgeStatus(page);
    expect(after.available, `bridge poisoned after 5 business errors; consecutiveFailures=${after.consecutiveFailures}, lastError=${after.lastErrorMessage}`).toBe(true);
  });

  test("after a business error, a successful invoke restores the bridge (in case it were ever marked unavailable)", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    // Trigger a business error.
    await invokeOrReject(page, "agent:load-session", { sessionId: "still-does-not-exist", cwd: "/tmp" });
    // Then a successful call.
    const ok = await invokeOrReject(page, "agent:presets-list", undefined);
    expect(ok.ok, `agent:presets-list failed after business error: ${ok.error}`).toBe(true);
    const status = await bridgeStatus(page);
    expect(status.available, `bridge should be available after a successful call; got: ${JSON.stringify(status)}`).toBe(true);
    expect(status.consecutiveFailures).toBe(0);
  });

  test("multi-step session lifecycle survives business errors mid-flight", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    // Step 1: trigger a business error (invalid sessionId)
    const fail = await invokeOrReject(page, "agent:load-session", { sessionId: "bad-id-1", cwd: "/tmp" });
    expect(fail.ok).toBe(false);
    expect(fail.isBridgeUnavailable).toBe(false);
    // Step 2: list sessions — must work despite step 1's failure.
    const lst = await invokeOrReject(page, "sessions:list", "/tmp");
    expect(lst.ok, `sessions:list failed after business error: ${lst.error}`).toBe(true);
    // Step 3: another business error
    const fail2 = await invokeOrReject(page, "agent:load-session", { sessionId: "bad-id-2", cwd: "/tmp" });
    expect(fail2.ok).toBe(false);
    expect(fail2.isBridgeUnavailable).toBe(false);
    // Step 4: pin a non-existent session — should be a clean business error too.
    const pin = await invokeOrReject(page, "sessions:set-pinned", { id: "another-bad-id", pinned: true });
    // sessions:set-pinned may or may not error on bad id depending on impl;
    // either way, bridge must not be poisoned.
    const status = await bridgeStatus(page);
    expect(status.available, `bridge poisoned mid-lifecycle; status=${JSON.stringify(status)}`).toBe(true);
  });
});
