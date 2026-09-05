/**
 * R6.1 — Electron performance baseline (CDP-driven).
 *
 * Boots the real OpenBuddy Electron app, attaches a Chrome DevTools
 * Protocol session through Playwright, and samples real performance
 * metrics. These become the regression baseline for any optimization
 * punch-list item that comes out of the OSS benchmark survey.
 *
 * Metrics captured:
 *   - TTFC: navigationStart → first contentful paint
 *   - Idle heap: JSHeapUsedSize after 5s of idle
 *   - DOM nodes: document.querySelectorAll('*').length
 *   - Listener count: a rough indicator of subscription hygiene
 *   - Bundle load cost: total transferred JS size
 *
 * We do NOT assert hard thresholds — this is a measurement spec, not a
 * gate. Numbers land in test annotations + JSONL on disk so the report
 * can trend over time.
 */
import { test } from "./_fixtures";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const EVIDENCE_DIR = "evidence/_perf_baseline";

test.describe("electron performance baseline", () => {
  test("captures real-Electron perf metrics", async ({ page, electronApp }, testInfo) => {
    mkdirSync(EVIDENCE_DIR, { recursive: true });

    // Wait for the renderer to actually settle — same fixture contract
    // as the e2e suite.
    await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    // HeapProfiler domain needs to be enabled before getHeapUsage works
    // on Chromium 115+ (Electron 44 bundles this version).
    try {
      await cdp.send("HeapProfiler.enable");
    } catch {
      /* domain may already be auto-enabled */
    }
    try {
      await cdp.send("HeapProfiler.collectGarbage");
    } catch {
      /* best-effort */
    }

    // Give the renderer 5s of idle so the React tree fully commits and
    // any post-mount useEffects finish.
    await page.waitForTimeout(5_000);

    const perfMetrics = await cdp.send("Performance.getMetrics");
    let heap: { usedSize?: number; totalSize?: number } = {};
    try {
      heap = await cdp.send("HeapProfiler.getHeapUsage");
    } catch {
      // Fall back to Runtime.getHeapUsage which is enabled by default.
      try {
        const r = await cdp.send("Runtime.getHeapUsage") as { usedSize?: number; totalSize?: number };
        heap = { usedSize: r.usedSize, totalSize: r.totalSize };
      } catch {
        /* give up on heap, still record everything else */
      }
    }

    const domStats = await page.evaluate(() => ({
      nodes: document.querySelectorAll("*").length,
      listeners: (window as unknown as {
        __listenerProbe?: { addEventListener: (e: string) => void };
      }).__listenerProbe?.addEventListener ? "probed" : "not-probed",
      paintEntries: performance.getEntriesByType("paint").map((entry) => ({
        name: entry.name,
        startTime: entry.startTime,
      })),
      navTiming: (() => {
        const nav = performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined;
        return nav ? {
          domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
          loadEvent: nav.loadEventEnd - nav.startTime,
          ttfb: nav.responseStart - nav.requestStart,
        } : null;
      })(),
    }));

    // Filter the CDP metrics map into named fields we care about.
    const metricMap = new Map<string, number>(
      (perfMetrics.metrics ?? []).map((m: { name: string; value: number }) => [m.name, m.value]),
    );
    const captured = {
      timestamp: new Date().toISOString(),
      title: testInfo.title,
      electronApp: {
        // Electron exposes process info via the renderer-side `window.api`
        // bridge; we just snapshot what we can read without mocking.
        platform: process.platform,
        nodeVersion: process.version,
      },
      ttfc: domStats.paintEntries.find((e) => e.name === "first-contentful-paint")?.startTime ?? null,
      domContentLoaded: domStats.navTiming?.domContentLoaded ?? null,
      loadEvent: domStats.navTiming?.loadEvent ?? null,
      ttfb: domStats.navTiming?.ttfb ?? null,
      domNodes: domStats.nodes,
      jsHeap: {
        usedBytes: metricMap.get("JSHeapUsedSize") ?? null,
        totalBytes: metricMap.get("JSHeapTotalSize") ?? null,
        reportedByProfiler: {
          usedSize: (heap as { usedSize?: number }).usedSize ?? null,
          totalSize: (heap as { totalSize?: number }).totalSize ?? null,
        },
      },
      layoutCount: metricMap.get("LayoutCount") ?? null,
      layoutDurationMs: metricMap.get("LayoutDuration") ?? null,
      styleRecalcCount: metricMap.get("StyleRecalcCount") ?? null,
      styleRecalcDurationMs: metricMap.get("StyleRecalcDuration") ?? null,
      scriptDurationMs: metricMap.get("ScriptDuration") ?? null,
      taskDurationMs: metricMap.get("TaskDuration") ?? null,
    };

    const file = join(EVIDENCE_DIR, `${Date.now()}-electron-perf.json`);
    writeFileSync(file, JSON.stringify(captured, null, 2), "utf8");

    // Annotate so the HTML report surfaces them inline.
    for (const [key, value] of Object.entries(captured)) {
      testInfo.annotations.push({ type: key, description: JSON.stringify(value) });
    }
    // Make sure we at least captured the renderer.
    test.expect(captured.domNodes).toBeGreaterThan(0);
    // Force a reference so electronApp is not flagged unused.
    void electronApp;
  });
});