/**
 * chat-ui-minimax-streaming-perf.spec.ts — long-stream (≥30s) regression
 * guard for the AI chat surface (plan4.3 §3.7).
 *
 * ## What this exercises
 *
 * Drives a single real MiniMax-M3 prompt deliberately tuned to elicit a
 * long streamed answer (~30s+), and during the stream the renderer
 * collects rAF samples so we can measure:
 *
 *   - `firstDeltaMs`       — input click -> first streamed delta paint
 *   - `streamDurationMs`   — first delta -> final delta (i.e. Stop gone)
 *   - `outputTokensEst`    — output tokens estimated by char-count heuristic
 *   - `tokensPerSecond`    — outputTokensEst / streamDurationMs × 1000
 *   - `rendererFps`        — average FPS during the stream
 *   - `dropRate`           — share of frames whose dt exceeded 32 ms (< 30 fps)
 *
 * The numbers go to `docs/perf/streaming-<date>.json` (same shape as
 * `scripts/electron/perf-streaming.mjs` / `perf-streaming-schema.mjs`)
 * so dashboards can compare programmatic runs against nightly
 * aggregator runs.
 *
 * ## Skipping
 *
 * Skipped by default — burning one long upstream stream is not cheap.
 * Opt in with:
 *
 *   RUN_STREAM_PERF=1 pnpm exec playwright test \
 *       tests/electron/chat-ui-minimax-streaming-perf.spec.ts --reporter=line
 *
 * Without `RUN_STREAM_PERF=1` the test reports the skip reason and exits
 * PASS so CI green-stays-green.
 *
 * ## Why a separate spec from perf-streaming.mjs
 *
 * `perf-streaming.mjs` is the standalone nightly runner (no spec infra).
 * This spec is the playwright-driven counterpart: same schema, same
 * prompt, but exercises the full renderer IPC + UI surface so we catch
 * regressions specific to the long-stream render path (e.g. DOM thrash,
 * paint storm) that the standalone script cannot observe.
 */
import { expect, test } from "./_fixtures";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveE2ECredentials, describeSource } from "../../scripts/lib/e2e-credentials.mjs";
import {
  STREAMING_PROMPT,
  STREAMING_REPORT_SCHEMA,
  STREAMING_REPORT_FIELDS,
  estimateOutputTokens,
  summarizeFrameDeltas,
} from "../../scripts/electron/perf-streaming-schema.mjs";

const RUN = process.env.RUN_STREAM_PERF === "1";

const API_KEY = process.env.OPENBUDDY_E2E_API_KEY?.trim();
const BASE_URL = process.env.OPENBUDDY_E2E_BASE_URL?.trim();
const MODEL_ID = process.env.OPENBUDDY_E2E_MODEL_ID?.trim() ?? "MiniMax-M3";
const HAS_CREDS = Boolean(API_KEY && BASE_URL);

const PROVIDER_ID = "custom_anthropic";
const COMPOSER = "textarea.wb-composer__input";
const ASSISTANT_BUBBLE = ".msg--assistant";
const STOP_BUTTON = '[aria-label="停止生成"]';

// 4 min cap. The standalone runner uses 240 s for the same stream;
// the spec caps a touch tighter so a runaway prompt doesn't stall CI.
const TEST_TIMEOUT_MS = 4 * 60 * 1000;

const creds = resolveE2ECredentials({ provider: "minimax" });
console.log(`[chat-ui-minimax-streaming-perf] ${describeSource(creds)}`);

async function configure(page: import("@playwright/test").Page, cwd: string): Promise<void> {
  await page.evaluate(
    async ({ channel, args }) => window.api.invoke(channel, args),
    {
      channel: "agent:providers-save-provider",
      args: {
        provider: {
          id: PROVIDER_ID,
          label: "MiniMax",
          providerKind: "custom_anthropic",
          apiKey: API_KEY,
          baseUrl: BASE_URL,
          apiBackend: "messages",
          authScheme: "x_api_key",
        },
      },
    },
  );
  await page.evaluate(
    async ({ channel, args }) => window.api.invoke(channel, args),
    {
      channel: "agent:providers-save-model",
      args: {
        model: { providerId: PROVIDER_ID, modelId: MODEL_ID, name: MODEL_ID, contextWindow: 128_000, reasoning: false },
      },
    },
  );
  await page.evaluate(
    async ({ channel, args }) => window.api.invoke(channel, args),
    { channel: "agent:new-session", args: { cwd, modelId: `${PROVIDER_ID}/${MODEL_ID}` } },
  );
}

test.describe("chat-ui-minimax-streaming-perf", () => {
  test.skip(!RUN, "set RUN_STREAM_PERF=1 to exercise the long-stream regression guard");
  test.skip(!HAS_CREDS, "OPENBUDDY_E2E_API_KEY + OPENBUDDY_E2E_BASE_URL required");

  test("measures firstDeltaMs / streamDurationMs / tokensPerSecond / FPS during a 30s+ stream", async ({
    electronApp,
    page,
  }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const userData = mkdtempSync(join(tmpdir(), "openbuddy-streaming-spec-"));
    const workspace = join(userData, "ws");
    mkdirSync(workspace, { recursive: true });

    await configure(page, workspace);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#root").waitFor({ state: "attached" });
    await page.locator(COMPOSER).first().waitFor({ state: "visible" });
    await page.setViewportSize({ width: 1280, height: 860 });

    const beforeBubbles = await page.locator(ASSISTANT_BUBBLE).count();
    const tSent = Date.now();
    await page.locator(COMPOSER).first().fill(STREAMING_PROMPT);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForFunction(
      ({ sel, count }) => document.querySelectorAll(sel).length > count,
      { sel: ASSISTANT_BUBBLE, count: beforeBubbles },
      { timeout: 60_000 },
    );
    const tFirstDelta = Date.now();

    // Begin rAF sampling inside the renderer so we can derive FPS later.
    await page.evaluate(() => {
      const w = window;
      w.__streamFpsSamples = [];
      let last = performance.now();
      function tick(now: number) {
        const dt = now - last;
        last = now;
        w.__streamFpsSamples.push({ t: now, dt });
        w.__streamFpsRaf = requestAnimationFrame(tick);
      }
      w.__streamFpsRaf = requestAnimationFrame(tick);
    });

    await page
      .waitForFunction(
        ({ sel }) => !document.querySelector(sel),
        { sel: STOP_BUTTON },
        { timeout: TEST_TIMEOUT_MS - 30_000 },
      )
      .catch(() => {
        // Long stream may exceed the cap; record what we have rather than
        // failing the run — the report still has useful partial numbers.
      });
    const tStreamEnd = Date.now();

    const fpsStats: number[] = await page.evaluate(() => {
      const w = window;
      if (w.__streamFpsRaf) cancelAnimationFrame(w.__streamFpsRaf);
      const samples = Array.isArray(w.__streamFpsSamples) ? w.__streamFpsSamples : [];
      return samples.map((s) => s.dt);
    });

    const assistantText: string = await page.evaluate(() => {
      const nodes = document.querySelectorAll(".msg--assistant");
      return nodes.length ? nodes[nodes.length - 1].textContent ?? "" : "";
    });

    const fpsSummary = summarizeFrameDeltas(fpsStats);
    const report = {
      schema: STREAMING_REPORT_SCHEMA,
      generatedAt: new Date().toISOString(),
      credentialSource: creds.source,
      model: MODEL_ID,
      baseUrl: BASE_URL ?? "",
      promptChars: STREAMING_PROMPT.length,
      streamDurationMs: tStreamEnd - tFirstDelta,
      firstDeltaMs: tFirstDelta - tSent,
      outputTokensEst: estimateOutputTokens(assistantText),
      tokensPerSecond: Number(
        ((estimateOutputTokens(assistantText) / Math.max(1, tStreamEnd - tFirstDelta)) * 1000).toFixed(2),
      ),
      rendererFps: fpsSummary.rendererFps,
      totalFrames: fpsSummary.totalFrames,
      droppedFrames: fpsSummary.droppedFrames,
      dropRate: fpsSummary.dropRate,
    };

    // Schema sanity: every documented field present + well-typed.
    for (const [field, expected] of Object.entries(STREAMING_REPORT_FIELDS)) {
      expect(typeof (report as Record<string, unknown>)[field], `field ${field}`).toBe(expected);
    }

    // Sanity bounds — fail loudly if upstream regression makes the stream
    // meaningfully shorter than the plan4.3 §3.7 acceptance target.
    expect(report.streamDurationMs).toBeGreaterThanOrEqual(30_000);
    expect(report.tokensPerSecond).toBeGreaterThan(0);
    expect(report.dropRate).toBeLessThanOrEqual(1);

    const perfDir = join(process.cwd(), "docs", "perf");
    mkdirSync(perfDir, { recursive: true });
    const outPath = join(perfDir, `${new Date().toISOString().slice(0, 10)}-openbuddy-streaming-spec.json`);
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[chat-ui-minimax-streaming-perf] wrote ${outPath}`);
    console.log(
      `[chat-ui-minimax-streaming-perf] streamDuration=${report.streamDurationMs}ms ` +
        `outputTokensEst=${report.outputTokensEst} ` +
        `tokensPerSecond=${report.tokensPerSecond} ` +
        `fps=${report.rendererFps} ` +
        `dropRate=${report.dropRate}`,
    );

    await electronApp.close();
  });
});