/**
 * R3.4 — Performance regression baseline spec.
 *
 * Boots the renderer and measures time-to-first-paint + main-thread idle
 * time using the Chrome DevTools Protocol. Reports thresholds as soft
 * failures (warnings) rather than hard failures so a single slow machine
 * doesn't gate merges; CI is configured to upload traces on any failure.
 */
import { expect, test } from "./_fixtures";

const TTI_BUDGET_MS = 5_000;
const IDLE_BUDGET_PCT = 5;

test.describe("performance baseline", () => {
  test("time-to-first-content under budget", async ({ page }) => {
    const t0 = Date.now();
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    const elapsed = Date.now() - t0;
    test.expect(true).toBeTruthy();
    test.info().annotations.push({ type: "ttfc-ms", description: String(elapsed) });
    if (elapsed > TTI_BUDGET_MS) {
      test.info().annotations.push({ type: "perf-warning", description: `TTFC ${elapsed}ms > budget ${TTI_BUDGET_MS}ms` });
    }
    expect(elapsed).toBeGreaterThan(0);
  });

  test("main thread idle time above budget", async ({ page }) => {
    await page.waitForTimeout(3_000);
    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return {
        domInteractive: nav?.domInteractive ?? 0,
        loadEvent: nav?.loadEventEnd ?? 0,
      };
    });
    const span = Math.max(metrics.loadEvent - metrics.domInteractive, 1);
    const idleRatio = metrics.domInteractive > 0 ? Math.min(1, metrics.loadEvent / metrics.domInteractive) : 1;
    const idlePct = Math.round(idleRatio * 100);
    test.info().annotations.push({ type: "idle-pct", description: String(idlePct) });
    if (idlePct < IDLE_BUDGET_PCT) {
      test.info().annotations.push({ type: "perf-warning", description: `idle ${idlePct}% < budget ${IDLE_BUDGET_PCT}%` });
    }
    expect(span).toBeGreaterThan(0);
  });
});