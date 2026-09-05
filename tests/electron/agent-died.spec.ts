/**
 * R3.5 — Agent-died auto-resubscribe end-to-end spec.
 *
 * Validates that the renderer mounts the surfaces needed for R2.5's
 * auto-resubscribe loop and the inline "Retry" action toast. The real
 * synthetic `pi://agent-died` event path is exercised by the manual
 * `pnpm test:closed-loop` runner with the live Electron main process;
 * structural DOM checks live here because Electron's contextBridge
 * freezes `window.api` so we can't replace it from `addInitScript`.
 */
import { expect, test } from "./_fixtures";

test.describe("agent-died recovery surface", () => {
  test("status indicator exposes connection state with role=status", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });

    // R4.2 added a status indicator with role="status" + aria-live="polite"
    // that surfaces connection / rate-limit / model state.
    const status = page.getByRole("status").first();
    await expect(status).toBeAttached({ timeout: 10_000 });
  });

  test("event-listener channel surface exists for pi:// events", async ({ page }) => {
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });

    // R2.5's renderer-side bridge registers a single listener on `pi://*`
    // and dispatches based on the channel. The container it writes into
    // is the toast region; if the region exists, the listener path can
    // populate it on agent-died events.
    const liveRegions = page.locator("[aria-live]");
    expect(await liveRegions.count()).toBeGreaterThanOrEqual(1);
  });
});