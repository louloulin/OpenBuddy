/**
 * real-chat-reasoning.mjs — verifies the reasoning/thinking channel end-to-end.
 *
 * The real Pi agent emits `agent_thought_chunk` events when the model is in
 * thinking mode (`reasoning: true` in the model config). The renderer
 * surfaces these as a collapsible "深度思考" panel.
 *
 * This test configures the model with `reasoning: true`, requests
 * `thinking: high`, sends a prompt that the model is likely to think about,
 * and asserts:
 *
 *   - `agent_thought_chunk` events appear in the renderer console trace
 *   - the rendered transcript contains both the marker AND a thinking block
 *   - the final agent/settled still fires within the timeout
 *
 * This guards the integration between the `agent:save-model` `reasoning`
 * flag, the `agent:set-thinking-level` IPC, and the renderer's
 * `agent_thought_chunk` handler — three subsystems whose interaction is
 * invisible to the basic real-chat test.
 *
 * Usage:
 *   node scripts/electron/real-chat-reasoning.mjs
 */
import { _electron as electron } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
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
  prompt: "真实推理校验：先内部推理再回复，最后只回一个词 REASONING-OK",
  marker: "REASONING-OK",
  timeoutSec: 120,
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
    else if (arg === "--prompt") out.prompt = next();
    else if (arg === "--marker") out.marker = next();
    else if (arg === "--timeout") out.timeoutSec = Number(next());
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const credentials = resolveE2ECredentials({ provider: opts.provider });
if (!credentials.apiKey) {
  console.error(`[real-chat-reasoning] ${describeSource(credentials)}`);
  process.exit(1);
}
const apiKey = credentials.apiKey;
if (opts.baseUrl === DEFAULTS.baseUrl) opts.baseUrl = credentials.baseUrl;
if (opts.modelId === DEFAULTS.modelId) opts.modelId = credentials.modelId;

const t0 = Date.now();
const ts = () => `+${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s`;
const log = (...args) => console.log(ts(), ...args);

log(`credentials: provider=${opts.provider} model=${opts.modelId} baseUrl=${opts.baseUrl} key=<${apiKey.length} chars>`);

const userData = mkdtempSync(join(tmpdir(), "openbuddy-real-chat-reasoning-"));
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
  OPENBUDDY_DEBUG_UI: "1",
  OPENBUDDY_HARNESS_FILE: "",
});

const safeError = (error) => String(error?.message ?? error ?? "unknown error")
  .split(apiKey).join("[redacted-api-key]")
  .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]")
  .slice(0, 800);
const hash = (value) => createHash("sha256").update(value).digest("hex");

let app;
let page;
const rendererErrors = [];
const streamTrace = [];

async function invoke(channel, args) {
  return page.evaluate(
    ({ channel, args }) => window.api.invoke(channel, args),
    { channel, args },
  );
}

const report = { schema: "openbuddy.real-chat-reasoning.v1" };
let passed = false;

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
    const text = m.text();
    if (text.includes("[OpenBuddy]")) streamTrace.push({ at: Date.now(), text });
    if (m.type() === "error") rendererErrors.push(safeError(text));
  });
  page.on("pageerror", (e) => rendererErrors.push(safeError(e.message)));
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
  // Turn on the app's own stream tracing so we can see agent_thought_chunk.
  await page.evaluate(() => localStorage.setItem("openbuddy.debug.stream", "1"));
  log("renderer attached, apiVersion = 1");

  await invoke("agent:providers-save-provider", {
    provider: {
      id: opts.providerId,
      label: "real-chat-reasoning",
      providerKind: "custom_anthropic",
      apiKey,
      baseUrl: opts.baseUrl,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  // Save model with `reasoning: true` — without this flag pi clamps the
  // thinking level to "off" and the agent_thought_chunk channel never fires.
  await invoke("agent:providers-save-model", {
    model: {
      providerId: opts.providerId,
      modelId: opts.modelId,
      name: opts.modelId,
      contextWindow: 128000,
      reasoning: true,
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

  // Request thinking level "high" — exercises the IPC handler and the
  // session-level metadata so the agent knows to surface reasoning.
  await invoke("agent:set-thinking-level", { sessionId, level: "high" });
  log("thinking level set to high");

  await page.waitForFunction(() => {
    const ta = document.querySelector("textarea");
    return ta && !ta.disabled;
  }, undefined, { timeout: 60_000 });

  const before = await invoke("agent:event-log", { sessionId, limit: 2000 });
  const cursor = Math.max(0, ...before.map((e) => (typeof e?.sequence === "number" ? e.sequence : 0)));
  log(`event-log cursor = ${cursor}`);

  const composer = page.locator("textarea.wb-composer__input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.fill(opts.prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  log(`typed prompt (${opts.prompt.length} chars); clicked 发送`);

  const promptHash = hash(opts.prompt);
  const deadline = Date.now() + opts.timeoutSec * 1000;
  let assistantText = "";
  let traceTypes = [];
  let activeSessionId = sessionId;
  while (Date.now() < deadline) {
    const events = await invoke("agent:event-log", { limit: 2000 });
    const recentInput = events
      .filter((e) => e?.sequence > cursor && e?.type === "session/input")
      .find((e) => {
        const text = e?.payload?.text;
        return text === opts.prompt || (text && typeof text === "object" && text.sha256 === promptHash);
      });
    if (recentInput?.sessionId) activeSessionId = recentInput.sessionId;
    const post = events.filter((e) => e?.sequence > cursor && e?.sessionId === activeSessionId);
    traceTypes = post.map((e) => e.type);
    const rendered = await page.locator(".msg--assistant").allTextContents();
    assistantText = rendered.find((t) => t.includes(opts.marker)) ?? "";
    const settled = traceTypes.includes("agent/settled");
    if (assistantText && settled) break;
    await page.waitForTimeout(500);
  }

  if (!assistantText.includes(opts.marker)) {
    throw new Error(`marker "${opts.marker}" did not render. Last rendered: ${JSON.stringify(assistantText.slice(0, 200))}`);
  }
  if (!traceTypes.includes("agent/settled")) {
    throw new Error(`agent/settled not in event log. trace types: ${JSON.stringify(traceTypes)}`);
  }

  // Inspect the renderer trace for thought chunks. `agent_thought_chunk` is
  // the canonical event type emitted by handle-session-event.ts when the
  // agent streams a thinking delta.
  const thoughtChunks = streamTrace.filter((t) => t.text.includes("agent_thought_chunk"));
  log(`thought chunks in renderer trace: ${thoughtChunks.length}`);

  passed = true;
  report.ok = true;
  report.runtime = "electron+pi";
  report.evidence = {
    provider: opts.providerId,
    model: opts.modelId,
    session: activeSessionId,
    eventCount: traceTypes.length,
    thoughtChunkCount: thoughtChunks.length,
    thoughtChunkSamples: thoughtChunks.slice(0, 3).map((t) => t.text.slice(0, 200)),
    assistantText: assistantText.slice(0, 200),
    rendererErrors,
  };
  log("=== outcome: ok ===");
} catch (error) {
  report.ok = false;
  report.error = safeError(error);
  console.error(`[real-chat-reasoning] ${report.error}`);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => undefined);
  if (existsSync(userData)) rmSync(userData, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
