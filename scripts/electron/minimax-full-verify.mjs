/**
 * minimax-full-verify.mjs — comprehensive MiniMax real-chat verification.
 *
 * Drives the real OpenBuddy Electron app against the configured MiniMax
 * endpoint and asserts the full chat path end-to-end:
 *
 *   1. Electron launches and the renderer mounts.
 *   2. The bridge IPC exposes `window.api.apiVersion === 1`.
 *   3. Configuring `custom_anthropic` via IPC flips `agent:auth-status.ready`.
 *   4. A new session is created and the composer enables.
 *   5. Three consecutive turns round-trip through MiniMax-M3 with the
 *      documented Pi event sequence (`session/input → agent/start →
 *      assistant/start → assistant/update* → assistant/end → agent/settled`).
 *   6. The rendered `.msg--assistant` bubble contains each turn's marker.
 *   7. The Pi event log records the expected provider metadata
 *      (`provider=custom_anthropic`, `model=MiniMax-M3`,
 *      `api=anthropic-messages`).
 *   8. The renderer emits zero unexpected console errors throughout.
 *
 * Why a separate script?
 * ----------------------
 * `real-ui-smoke.mjs` covers the Settings UI path; `real-chat-verify.mjs`
 * covers single-turn IPC; `real-chat-multiturn.mjs` covers two-turn
 * persistence; `real-chat-reasoning.mjs` covers thinking events. This
 * script is the all-in-one smoke that:
 *
 *   - exercises 3 turns of cross-turn context
 *   - asserts provider metadata in the wire trace
 *   - asserts no renderer errors leak through
 *   - writes a JSON evidence artifact for diffing across runs
 *
 * Usage:
 *   node scripts/electron/minimax-full-verify.mjs
 *   node scripts/electron/minimax-full-verify.mjs --model MiniMax-M2.7
 *   node scripts/electron/minimax-full-verify.mjs --evidence-dir ./evidence
 *
 * Reads the API key from `.env.e2e.local` (gitignored) via the shared
 * `e2e-credentials.mjs` resolver, never prints it.
 */
import { _electron as electron } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER,
  REPO_ROOT as ROOT,
  describeSource,
  resolveE2ECredentials,
  scrubProviderCredentials,
} from "../lib/e2e-credentials.mjs";

const DEFAULTS = {
  baseUrl: DEFAULT_BASE_URL,
  modelId: DEFAULT_MODEL_ID,
  provider: DEFAULT_PROVIDER,
  providerId: "custom_anthropic",
  timeoutSec: 90,
  evidenceDir: "",
};

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${arg} requires a value`);
      i += 1;
      return v;
    };
    if (arg === "--base-url") out.baseUrl = next();
    else if (arg === "--model") out.modelId = next();
    else if (arg === "--provider") out.provider = next();
    else if (arg === "--timeout") out.timeoutSec = Number(next());
    else if (arg === "--evidence-dir") out.evidenceDir = next();
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const credentials = resolveE2ECredentials({ provider: opts.provider });
if (!credentials.apiKey) {
  console.error(`[minimax-full-verify] ${describeSource(credentials)}`);
  process.exit(1);
}
const apiKey = credentials.apiKey;
if (opts.baseUrl === DEFAULTS.baseUrl) opts.baseUrl = credentials.baseUrl;
if (opts.modelId === DEFAULTS.modelId) opts.modelId = credentials.modelId;

const t0 = Date.now();
const ts = () => `+${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s`;
const log = (...args) => console.log(ts(), ...args);

log(`credentials: provider=${opts.provider} model=${opts.modelId} baseUrl=${opts.baseUrl} key=<${apiKey.length} chars from ${credentials.source}>`);

const userData = mkdtempSync(join(tmpdir(), "openbuddy-minimax-full-verify-"));
const piAgentDir = join(userData, "pi-agent");
const workspace = join(userData, "workspace");
mkdirSync(piAgentDir, { recursive: true });
mkdirSync(workspace, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

const childEnv = scrubProviderCredentials(process.env);
Object.assign(childEnv, {
  ELECTRON_RENDERER_URL: "",
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_DEBUG_UI: "0",
  OPENBUDDY_HARNESS_FILE: "",
});

const safeError = (error) => String(error?.message ?? error ?? "unknown error")
  .split(apiKey).join("[redacted-api-key]")
  .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]")
  .slice(0, 600);

const hash = (value) => createHash("sha256").update(value).digest("hex");

let app;
let page;
const rendererErrors = [];
const report = {
  schema: "openbuddy.minimax-full-verify.v1",
  ok: false,
  startedAt: new Date().toISOString(),
  runtime: "electron+pi",
};

async function invoke(channel, args) {
  return page.evaluate(({ channel, args }) => window.api.invoke(channel, args), { channel, args });
}

const TURNS = [
  {
    prompt: `Reply with exactly: ALPHA-${opts.modelId}-OK. No other words, no punctuation, no greeting.`,
    marker: `ALPHA-${opts.modelId}-OK`,
  },
  {
    prompt: `Reply with exactly: BETA-${opts.modelId}-OK. No other words, no punctuation, no greeting.`,
    marker: `BETA-${opts.modelId}-OK`,
  },
  {
    prompt: `Reply with exactly: GAMMA-${opts.modelId}-OK. No other words, no punctuation, no greeting.`,
    marker: `GAMMA-${opts.modelId}-OK`,
  },
];

try {
  log("launching Electron…");
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, ROOT],
    executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(ROOT, "node_modules", ".bin", "electron"),
    cwd: ROOT,
    timeout: 60_000,
    env: childEnv,
  });
  page = await app.firstWindow();
  page.on("console", (m) => {
    if (m.type() === "error") rendererErrors.push(safeError(m.text()));
  });
  page.on("pageerror", (e) => rendererErrors.push(safeError(e.message)));
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
  log("renderer attached, apiVersion = 1");

  log(`configuring provider ${opts.providerId} → ${opts.baseUrl} (${opts.modelId})`);
  await invoke("agent:providers-save-provider", {
    provider: {
      id: opts.providerId,
      label: "minimax-full-verify",
      providerKind: "custom_anthropic",
      apiKey,
      baseUrl: opts.baseUrl,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  await invoke("agent:providers-save-model", {
    model: {
      providerId: opts.providerId,
      modelId: opts.modelId,
      name: opts.modelId,
      contextWindow: 128000,
      reasoning: false,
    },
  });
  const auth = await invoke("agent:auth-status");
  if (auth?.ready !== true) throw new Error(`auth not ready: ${JSON.stringify(auth)}`);
  log("auth-status.ready = true");

  const created = await invoke("agent:new-session", {
    cwd: workspace,
    modelId: `${opts.providerId}/${opts.modelId}`,
  });
  const sessionId = created?.sessionId;
  if (!sessionId) throw new Error(`agent:new-session returned no sessionId: ${JSON.stringify(created)}`);
  log(`session created = ${sessionId.slice(0, 12)}…`);

  await page.waitForFunction(() => {
    const ta = document.querySelector("textarea");
    return ta && !ta.disabled;
  }, undefined, { timeout: 60_000 });
  log("composer enabled");

  const composer = page.locator("textarea.wb-composer__input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  const turnResults = [];
  let cursor = 0;
  for (let i = 0; i < TURNS.length; i += 1) {
    const turn = TURNS[i];
    const before = await invoke("agent:event-log", { limit: 2000 });
    cursor = Math.max(cursor, ...before.map((e) => (typeof e?.sequence === "number" ? e.sequence : 0)));
    log(`turn ${i + 1}/${TURNS.length}: marker="${turn.marker}"`);
    await composer.fill(turn.prompt);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const promptHash = hash(turn.prompt);
    const deadline = Date.now() + opts.timeoutSec * 1000;
    let rendered = "";
    let traceTypes = [];
    let activeSessionId = sessionId;
    while (Date.now() < deadline) {
      const events = await invoke("agent:event-log", { limit: 2000 });
      const recentInput = events
        .filter((e) => e?.sequence > cursor && e?.type === "session/input")
        .find((e) => {
          const text = e?.payload?.text;
          return text === turn.prompt || (text && typeof text === "object" && text.sha256 === promptHash);
        });
      if (recentInput?.sessionId) activeSessionId = recentInput.sessionId;
      const post = events.filter((e) => e?.sequence > cursor && e?.sessionId === activeSessionId);
      traceTypes = post.map((e) => e.type);
      const bubbles = await page.locator(".msg--assistant").allTextContents();
      rendered = bubbles.find((t) => t.includes(turn.marker)) ?? "";
      const settled = traceTypes.includes("agent/settled");
      if (rendered && settled) {
        log(`marker rendered + agent/settled (${traceTypes.length} new events)`);
        break;
      }
      await page.waitForTimeout(500);
    }
    if (!rendered.includes(turn.marker)) {
      throw new Error(`turn ${i + 1} marker "${turn.marker}" did not render. Last rendered: ${JSON.stringify(rendered.slice(0, 300))}`);
    }
    if (!traceTypes.includes("agent/settled")) {
      throw new Error(`turn ${i + 1} agent/settled missing. trace types: ${JSON.stringify(traceTypes)}`);
    }
    const required = ["session/input", "agent/start", "assistant/start", "assistant/end", "agent/settled"];
    for (const type of required) {
      if (!traceTypes.includes(type)) throw new Error(`turn ${i + 1} missing required event "${type}". trace types: ${JSON.stringify(traceTypes)}`);
    }
    const allEvents = await invoke("agent:event-log", { limit: 2000 });
    const providerEvents = allEvents
      .filter((e) => e?.sessionId === activeSessionId && ["assistant/start", "assistant/update", "assistant/end"].includes(e.type))
      .map((e) => JSON.stringify(e.payload ?? e))
      .join("\n");
    const provider = allEvents.find((e) => e?.sessionId === activeSessionId && e.type === "assistant/start")?.payload?.message?.provider
      ?? allEvents.find((e) => e?.sessionId === activeSessionId && e.type === "assistant/end")?.payload?.message?.provider;
    const model = allEvents.find((e) => e?.sessionId === activeSessionId && e.type === "assistant/start")?.payload?.message?.model
      ?? allEvents.find((e) => e?.sessionId === activeSessionId && e.type === "assistant/end")?.payload?.message?.model;
    const api = allEvents.find((e) => e?.sessionId === activeSessionId && e.type === "assistant/start")?.payload?.message?.api
      ?? allEvents.find((e) => e?.sessionId === activeSessionId && e.type === "assistant/end")?.payload?.message?.api;
    if (!providerEvents.includes("custom_anthropic") || !providerEvents.includes(opts.modelId) || !providerEvents.includes("anthropic-messages")) {
      throw new Error(`turn ${i + 1} provider/model/api mismatch: ${JSON.stringify({ provider, model, api })}`);
    }
    turnResults.push({
      turn: i + 1,
      marker: turn.marker,
      session: activeSessionId,
      eventCount: traceTypes.length,
      eventTypes: traceTypes,
      assistantText: rendered.slice(0, 200),
      providerMetadata: { provider, model, api },
    });
    cursor = Math.max(cursor, ...allEvents.map((e) => (typeof e?.sequence === "number" ? e.sequence : 0)));
  }

  if (rendererErrors.length > 0) {
    throw new Error(`renderer emitted ${rendererErrors.length} unexpected error(s): ${rendererErrors.slice(0, 3).join(" | ")}`);
  }

  report.ok = true;
  report.evidence = {
    provider: opts.providerId,
    model: opts.modelId,
    baseUrl: opts.baseUrl,
    session: sessionId,
    turns: turnResults,
    rendererErrors: [],
  };
  log(`=== outcome: ok === (${turnResults.length} turns, ${rendererErrors.length} renderer errors)`);
} catch (error) {
  report.ok = false;
  report.error = safeError(error);
  console.error(`[minimax-full-verify] ${report.error}`);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => undefined);
  if (existsSync(userData)) rmSync(userData, { recursive: true, force: true });
  report.rendererErrors = rendererErrors;
  report.finishedAt = new Date().toISOString();
  if (opts.evidenceDir) {
    mkdirSync(opts.evidenceDir, { recursive: true });
    writeFileSync(join(opts.evidenceDir, "minimax-full-verify.json"), JSON.stringify(report, null, 2));
    report.evidenceArtifact = join(opts.evidenceDir, "minimax-full-verify.json");
  }
  console.log(JSON.stringify(report, null, 2));
}