/**
 * perf-streaming.mjs — measure the AI chat renderer's ability to keep up
 * with a long-running MiniMax stream (≥30s target). Writes
 * `docs/perf/streaming-<date>.json` for historical tracking.
 *
 * What we measure (see perf-streaming-schema.mjs for the canonical field list):
 *   - `streamDurationMs` — first delta paint to last delta paint
 *   - `tokensPerSecond` — estimated output tokens / stream duration
 *   - `rendererFps`     — rAF samples collected during the stream
 *   - `droppedFrames`   — frames whose dt exceeded 32ms (i.e. < 30 fps)
 *   - `dropRate`        — droppedFrames / total frames
 *   - `firstDeltaMs`    — input -> first streamed delta paint latency
 *   - `outputTokensEst` — output tokens estimated by character count / 4
 *
 * Usage:
 *   RUN_STREAM_PERF=1 node scripts/electron/perf-streaming.mjs
 *
 * Without `RUN_STREAM_PERF=1` the script prints a notice and exits 0 —
 * keeps the script safe to invoke from CI without burning tokens.
 * Credentials resolve through scripts/lib/e2e-credentials.mjs.
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveE2ECredentials, describeSource, scrubProviderCredentials } from "../lib/e2e-credentials.mjs";
import {
  STREAMING_PROMPT,
  createStreamingReport,
  estimateOutputTokens,
  summarizeFrameDeltas,
} from "./perf-streaming-schema.mjs";

const ROOT = process.cwd();

if (!process.env.RUN_STREAM_PERF) {
  console.log("[streaming-perf] RUN_STREAM_PERF not set; skipping (set it to actually run).");
  process.exit(0);
}

const creds = resolveE2ECredentials({ provider: "minimax" });
if (!creds.apiKey) {
  console.error(`[streaming-perf] no credentials: ${describeSource(creds)}`);
  process.exit(1);
}
const modelId = creds.modelId ?? "MiniMax-M3";
const providerId = "custom_anthropic";
const perfDir = join(ROOT, "docs", "perf");
mkdirSync(perfDir, { recursive: true });
const outPath = join(perfDir, `${new Date().toISOString().slice(0, 10)}-openbuddy-streaming.json`);

const userData = mkdtempSync(join(tmpdir(), "openbuddy-streaming-perf-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), "{}\n", { mode: 0o600 });

const childEnv = scrubProviderCredentials(process.env);
Object.assign(childEnv, {
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_DEBUG_UI: "0",
  OPENBUDDY_HARNESS_FILE: "",
});

const report = createStreamingReport({
  credentialSource: creds.source,
  model: modelId,
  baseUrl: creds.baseUrl ?? "",
});

const COMPOSER = "textarea.wb-composer__input";
const ASSISTANT = ".msg--assistant";
const STOP_BUTTON = '[aria-label="停止生成"]';

async function invoke(page, channel, args) {
  return page.evaluate(
    ({ channel, args }) => window.api.invoke(channel, args),
    { channel, args },
  );
}

async function waitForStopSettle(page, timeoutMs = 240_000) {
  await page.waitForFunction(
    ({ sel }) => !document.querySelector(sel),
    { sel: STOP_BUTTON },
    { timeout: timeoutMs },
  ).catch(() => {});
}

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT,
  timeout: 60_000,
  env: childEnv,
});
const page = await app.firstWindow();
try {
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 30_000 });
  await page.setViewportSize({ width: 1280, height: 860 });

  // ---------- configure MiniMax + new session ----------
  await invoke(page, "agent:providers-save-provider", {
    provider: {
      id: providerId,
      label: "MiniMax",
      providerKind: "custom_anthropic",
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  await invoke(page, "agent:providers-save-model", {
    model: { providerId, modelId, name: modelId, contextWindow: 128000, reasoning: false },
  });
  await invoke(page, "agent:new-session", {
    cwd: join(userData, "ws"),
    modelId: `${providerId}/${modelId}`,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 30_000 });

  // ---------- start the long stream ----------
  await page.locator(COMPOSER).first().fill(STREAMING_PROMPT);
  const tSent = performance.now();
  await page.getByRole("button", { name: "发送", exact: true }).click();

  const beforeFirst = await page.locator(ASSISTANT).count();
  await page.waitForFunction(
    ({ sel, count }) => document.querySelectorAll(sel).length > count,
    { sel: ASSISTANT, count: beforeFirst },
    { timeout: 60_000 },
  );
  const tFirstDelta = performance.now();
  report.firstDeltaMs = Math.round(tFirstDelta - tSent);

  // Sample rAF timestamps inside the renderer so we can compute
  // FPS + dropped-frame rate for the duration of the stream.
  await page.evaluate(() => {
    const w = window;
    w.__streamFpsSamples = [];
    let last = performance.now();
    function tick(now) {
      const dt = now - last;
      last = now;
      w.__streamFpsSamples.push({ t: now, dt });
      w.__streamFpsRaf = requestAnimationFrame(tick);
    }
    w.__streamFpsRaf = requestAnimationFrame(tick);
  });

  await waitForStopSettle(page);
  const tStreamEnd = performance.now();

  const fpsStats = await page.evaluate(() => {
    const w = window;
    if (w.__streamFpsRaf) cancelAnimationFrame(w.__streamFpsRaf);
    const samples = Array.isArray(w.__streamFpsSamples) ? w.__streamFpsSamples : [];
    return samples.map((s) => s.dt);
  });

  const assistantText = await page.evaluate(() => {
    const nodes = document.querySelectorAll(".msg--assistant");
    return nodes.length ? nodes[nodes.length - 1].textContent ?? "" : "";
  });

  report.streamDurationMs = Math.round(tStreamEnd - tFirstDelta);
  report.outputTokensEst = estimateOutputTokens(assistantText);
  report.tokensPerSecond = Number(((report.outputTokensEst / Math.max(1, report.streamDurationMs)) * 1000).toFixed(2));

  const fpsSummary = summarizeFrameDeltas(fpsStats);
  report.rendererFps = fpsSummary.rendererFps;
  report.totalFrames = fpsSummary.totalFrames;
  report.droppedFrames = fpsSummary.droppedFrames;
  report.dropRate = fpsSummary.dropRate;

  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[streaming-perf] wrote ${outPath}`);
  console.log(
    `[streaming-perf] streamDuration=${report.streamDurationMs}ms ` +
      `outputTokensEst=${report.outputTokensEst} ` +
      `tokensPerSecond=${report.tokensPerSecond} ` +
      `fps=${report.rendererFps} ` +
      `dropRate=${report.dropRate}`,
  );
} catch (err) {
  console.error(`[streaming-perf] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  try { rmSync(userData, { recursive: true, force: true }); } catch {}
}
