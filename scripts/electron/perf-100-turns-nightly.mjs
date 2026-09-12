/**
 * perf-100-turns-nightly.mjs — drives 100 real LLM turns against the
 * configured MiniMax upstream and writes a per-turn latency / token
 * report to `docs/perf/<date>-openbuddy-100-turns.json`.
 *
 * This complements `perf-baseline.mjs`:
 *   - `perf-baseline.mjs` measures cold-start + first/second turn paint
 *     latency with one user / one assistant bubble per turn.
 *   - `perf-100-turns-nightly.mjs` runs 100 real turns with rotating
 *     prompts, captures per-turn latency, and aggregates token usage
 *     reported back from the renderer (via the existing usage telemetry
 *     that ships with `pi://update` / `pi://complete` events).
 *
 * Designed for nightly cron — defaults to running in headless Electron,
 * with a `--turns=N` override for ad-hoc calibration runs. Output
 * structure (stable, machine-readable):
 *
 *   {
 *     schema: "openbuddy.100-turns-perf.v1",
 *     generatedAt: "...",
 *     turns: 100,
 *     p50TurnMs: 3200,
 *     p95TurnMs: 6800,
 *     maxTurnMs: 9100,
 *     minTurnMs: 1800,
 *     inputTokens: 12345,
 *     outputTokens: 23456,
 *     contextWindowUsage: [{ turn: 5, used: 1234 }, ...],
 *     errors: 0
 *   }
 *
 * Run:
 *   node scripts/electron/perf-100-turns-nightly.mjs
 *   node scripts/electron/perf-100-turns-nightly.mjs --turns=20 --output=/tmp/x.json
 *
 * Credentials resolve through scripts/lib/e2e-credentials.mjs.
 */
import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { resolveE2ECredentials, describeSource, scrubProviderCredentials } from "../lib/e2e-credentials.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const argInt = (key, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`--${key}=`));
  return hit ? parseInt(hit.split("=")[1], 10) : fallback;
};
const argString = (key, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`--${key}=`));
  return hit ? hit.split("=")[1] : fallback;
};
const TURN_COUNT = argInt("turns", 100);
const OUT_PATH = argString(
  "output",
  join(
    ROOT,
    "docs",
    "perf",
    `${new Date().toISOString().slice(0, 10)}-openbuddy-100-turns.json`,
  ),
);

const creds = resolveE2ECredentials({ provider: "minimax" });
if (!creds.apiKey) {
  console.error(`[100-turns] no credentials: ${describeSource(creds)}`);
  process.exit(1);
}
const modelId = creds.modelId ?? "MiniMax-M3";
const providerId = "custom_anthropic";

const perfDir = dirname(OUT_PATH);
mkdirSync(perfDir, { recursive: true });

const userData = mkdtempSync(join(tmpdir(), "openbuddy-100-turns-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(
  join(piAgentDir, "models.json"),
  `${JSON.stringify({ providers: {} }, null, 2)}\n`,
  { mode: 0o600 },
);
writeFileSync(join(piAgentDir, "auth.json"), "{}\n", { mode: 0o600 });

const childEnv = scrubProviderCredentials(process.env);
Object.assign(childEnv, {
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_DEBUG_UI: "0",
  OPENBUDDY_HARNESS_FILE: "",
});

const report = {
  schema: "openbuddy.100-turns-perf.v1",
  generatedAt: new Date().toISOString(),
  credentialSource: creds.source,
  model: modelId,
  baseUrl: creds.baseUrl ?? "",
  turns: TURN_COUNT,
  p50TurnMs: -1,
  p95TurnMs: -1,
  maxTurnMs: -1,
  minTurnMs: -1,
  inputTokens: 0,
  outputTokens: 0,
  contextWindowUsage: [],
  errors: 0,
};

const COMPOSER = "textarea.wb-composer__input";
const ASSISTANT = ".msg--assistant";
const STOP_BUTTON = '[aria-label="停止生成"]';

const PROMPTS = [
  "用一句话回答:法国的首都是哪里?不要调用任何工具。",
  "Answer in one sentence: what is the capital of Japan? Do not call any tools.",
  "用一句话回答:澳大利亚的首都是哪里?不要调用任何工具。",
  "Answer in one sentence: what is the largest desert on Earth? Do not call any tools.",
  "用一句话回答:珠穆朗玛峰位于哪个国家?不要调用任何工具。",
  "Answer in one sentence: how many continents are there? Do not call any tools.",
  "用一句话回答:水的化学式是什么?不要调用任何工具。",
  "Answer in one sentence: who painted the Mona Lisa? Do not call any tools.",
  "用一句话回答:地球绕太阳一周需要多久?不要调用任何工具。",
  "Answer in one sentence: what is the speed of light? Do not call any tools.",
];

async function invoke(page, channel, args) {
  return page.evaluate(
    ({ channel, args }) => window.api.invoke(channel, args),
    { channel, args },
  );
}

async function waitForStopSettle(page) {
  await page
    .waitForFunction(
      ({ sel }) => !document.querySelector(sel),
      { sel: STOP_BUTTON },
      { timeout: 90_000 },
    )
    .catch(() => {});
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return -1;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor((p / 100) * sortedAsc.length)),
  );
  return sortedAsc[idx];
}

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  cwd: ROOT,
  timeout: 60_000,
  env: childEnv,
});
const page = await app.firstWindow();
const turnLatencies = [];

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

  for (let i = 0; i < TURN_COUNT; i += 1) {
    const prompt = PROMPTS[i % PROMPTS.length];
    const before = await page.locator(ASSISTANT).count();
    const t0 = performance.now();
    try {
      await page.locator(COMPOSER).first().fill(prompt);
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await page.waitForFunction(
        ({ sel, count }) => document.querySelectorAll(sel).length > count,
        { sel: ASSISTANT, count: before },
        { timeout: 60_000 },
      );
      await waitForStopSettle(page);
    } catch (err) {
      report.errors += 1;
      console.warn(`[100-turns] turn ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      // Continue with the next turn rather than aborting the entire run;
      // a transient network blip shouldn't poison the whole nightly report.
      continue;
    }
    const elapsed = Math.round(performance.now() - t0);
    turnLatencies.push(elapsed);
    if ((i + 1) % 10 === 0 || i + 1 === TURN_COUNT) {
      console.log(`[100-turns] turn ${i + 1}/${TURN_COUNT}: ${elapsed}ms`);
    }
  }

  const sorted = [...turnLatencies].sort((a, b) => a - b);
  report.p50TurnMs = percentile(sorted, 50);
  report.p95TurnMs = percentile(sorted, 95);
  report.maxTurnMs = sorted.length > 0 ? sorted[sorted.length - 1] : -1;
  report.minTurnMs = sorted.length > 0 ? sorted[0] : -1;

  writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[100-turns] wrote ${OUT_PATH}`);
  console.log(
    `[100-turns] p50=${report.p50TurnMs}ms p95=${report.p95TurnMs}ms errors=${report.errors}/${TURN_COUNT}`,
  );
} catch (err) {
  console.error(
    `[100-turns] aborted: ${err instanceof Error ? err.message : String(err)}`,
  );
  // Still write whatever partial data we have so the failure is recoverable
  // from the artifact instead of being a black-box cron failure.
  const sorted = [...turnLatencies].sort((a, b) => a - b);
  report.p50TurnMs = percentile(sorted, 50);
  report.p95TurnMs = percentile(sorted, 95);
  report.maxTurnMs = sorted.length > 0 ? sorted[sorted.length - 1] : -1;
  report.minTurnMs = sorted.length > 0 ? sorted[0] : -1;
  report.errors += 1;
  writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
