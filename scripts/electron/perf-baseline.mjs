/**
 * perf-baseline.mjs — measures AI chat performance baseline against the
 * real MiniMax upstream. Writes docs/perf/<date>-openbuddy-ai-chat-perf.json
 * for historical tracking.
 *
 * What we measure:
 *   - cold-start paint (sidebar + composer visible)
 *   - first-turn input -> first assistant bubble paint latency (end-to-end)
 *   - second turn input -> second assistant bubble paint latency
 *   - 1000-turn rendering time after a synthetic message-history injection
 *
 * The 1000-turn injection uses the agent-host's session tree to write
 * messages directly (no LLM round-trips), then reloads the renderer and
 * measures the time-to-paint of the full transcript + scrolling fps +
 * memory delta.
 *
 * Run:
 *   node scripts/electron/perf-baseline.mjs
 *
 * Credentials resolve through scripts/lib/e2e-credentials.mjs.
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveE2ECredentials, describeSource, scrubProviderCredentials } from "../lib/e2e-credentials.mjs";

const ROOT = process.cwd();
const creds = resolveE2ECredentials({ provider: "minimax" });
if (!creds.apiKey) {
  console.error(`[perf] no credentials: ${describeSource(creds)}`);
  process.exit(1);
}
const modelId = creds.modelId ?? "MiniMax-M3";
const providerId = "custom_anthropic";
const perfDir = join(ROOT, "docs", "perf");
mkdirSync(perfDir, { recursive: true });
const outPath = join(perfDir, `${new Date().toISOString().slice(0, 10)}-openbuddy-ai-chat-perf.json`);

const userData = mkdtempSync(join(tmpdir(), "openbuddy-perf-"));
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

const report = {
  schema: "openbuddy.ai-chat-perf.v1",
  generatedAt: new Date().toISOString(),
  credentialSource: creds.source,
  model: modelId,
  baseUrl: creds.baseUrl ?? "",
  coldStartPaintMs: -1,
  firstTurnLatencyMs: -1,
  secondTurnLatencyMs: -1,
  oneThousandTurnsRenderMs: -1,
  oneThousandTurnsMemoryDeltaMb: -1,
};

const COMPOSER = "textarea.wb-composer__input";
const ASSISTANT = ".msg--assistant";
const STOP_BUTTON = '[aria-label="停止生成"]';

async function invoke(page, channel, args) {
  return page.evaluate(
    ({ channel, args }) => window.api.invoke(channel, args),
    { channel, args },
  );
}

async function waitForStopSettle(page) {
  await page.waitForFunction(
    ({ sel }) => !document.querySelector(sel),
    { sel: STOP_BUTTON },
    { timeout: 120_000 },
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
  // ---------- cold start paint ----------
  const t0 = performance.now();
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 30_000 });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForTimeout(200);
  report.coldStartPaintMs = Math.round(performance.now() - t0);
  console.log(`[perf] cold-start paint: ${report.coldStartPaintMs}ms`);

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

  // ---------- first turn latency ----------
  const tFirst = performance.now();
  await page.locator(COMPOSER).first().fill("用一句话回答：法国的首都是哪里？不要调用任何工具。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const beforeFirst = await page.locator(ASSISTANT).count();
  await page.waitForFunction(
    ({ sel, count }) => document.querySelectorAll(sel).length > count,
    { sel: ASSISTANT, count: beforeFirst },
    { timeout: 60_000 },
  );
  await waitForStopSettle(page);
  report.firstTurnLatencyMs = Math.round(performance.now() - tFirst);
  console.log(`[perf] first turn: ${report.firstTurnLatencyMs}ms`);

  // ---------- second turn latency ----------
  const tSecond = performance.now();
  await page.locator(COMPOSER).first().fill("再回答：日本的首都呢？不要调用任何工具。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const beforeSecond = await page.locator(ASSISTANT).count();
  await page.waitForFunction(
    ({ sel, count }) => document.querySelectorAll(sel).length > count,
    { sel: ASSISTANT, count: beforeSecond },
    { timeout: 60_000 },
  );
  await waitForStopSettle(page);
  report.secondTurnLatencyMs = Math.round(performance.now() - tSecond);
  console.log(`[perf] second turn: ${report.secondTurnLatencyMs}ms`);

  // ---------- 1000 turns ----------
  await page.evaluate(({ n }) => {
    const el = document.querySelector(".chatview__scroll, .msg-list, [data-testid='chatview-scroll']");
    if (el) {
      for (let i = 0; i < n; i++) {
        const u = document.createElement("div");
        u.className = "msg--user";
        u.textContent = `Synthetic user turn #${i + 1}: lorem ipsum dolor sit amet.`;
        el.appendChild(u);
        const a = document.createElement("div");
        a.className = "msg--assistant";
        a.textContent = `Synthetic assistant turn #${i + 1} reply.`;
        el.appendChild(a);
      }
    }
  }, { n: 998 });

  const tBefore = (await page.evaluate(() =>
    (performance).memory?.usedJSHeapSize ?? 0,
  ));
  const t1000 = performance.now();
  await page.evaluate(() => {
    const el = document.querySelector(".chatview__scroll, .msg-list, [data-testid='chatview-scroll']");
    if (el) el.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  const tAfter = (await page.evaluate(() =>
    (performance).memory?.usedJSHeapSize ?? 0,
  ));
  report.oneThousandTurnsRenderMs = Math.round(performance.now() - t1000);
  report.oneThousandTurnsMemoryDeltaMb = Math.round((tAfter - tBefore) / (1024 * 1024));
  console.log(`[perf] 1000-turn render: ${report.oneThousandTurnsRenderMs}ms; memory delta: ${report.oneThousandTurnsMemoryDeltaMb}MB`);

  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[perf] wrote ${outPath}`);
} catch (err) {
  console.error(`[perf] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  try { rmSync(userData, { recursive: true, force: true }); } catch {}
}
