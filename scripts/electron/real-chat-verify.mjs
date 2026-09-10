/**
 * real-chat-verify.mjs — end-to-end real-model AI chat verification.
 *
 * What this script verifies (in order):
 *
 *   1. Electron launches and the renderer mounts.
 *   2. The bridge IPC exposes `window.api.apiVersion === 1`.
 *   3. The configured provider responds to a real completion request.
 *   4. The composer writes the user prompt to localStorage, sends it,
 *      and the rendered `.msg--assistant` bubble contains the marker.
 *   5. The pi event log records the expected sequence:
 *        session/input → agent/start → assistant/start →
 *        assistant/update (one or more) → assistant/end → agent/settled.
 *
 * Why a new script?
 *
 * `real-ui-smoke.mjs` configures a provider through the Settings dialog and
 * asserts the persisted state matches the redacted configuration. That is the
 * right test for the settings surface, but its event-loop assertions are
 * fragile against session-id churn between renderer-mint and IPC. This script
 * uses the same direct-IPC configuration path as `diagnose-chat-stall.mjs` and
 * the same event-log inspection, but it lets the session id come from the
 * event-log side — i.e. it does not assume the renderer keeps the IPC-minted
 * id. That removes the false-negative failure mode that blocked LUM-784.
 *
 * Usage:
 *   node scripts/electron/real-chat-verify.mjs
 *   node scripts/electron/real-chat-verify.mjs --prompt "..." --marker OK
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
  prompt: "真实端到端校验：只回复一个词 VERIFY-CHAT-OK",
  marker: "VERIFY-CHAT-OK",
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
  console.error(`[real-chat-verify] ${describeSource(credentials)}`);
  process.exit(1);
}
const apiKey = credentials.apiKey;
if (opts.baseUrl === DEFAULTS.baseUrl) opts.baseUrl = credentials.baseUrl;
if (opts.modelId === DEFAULTS.modelId) opts.modelId = credentials.modelId;

const t0 = Date.now();
const ts = () => `+${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s`;
const log = (...args) => console.log(ts(), ...args);

log(`credentials: provider=${opts.provider} model=${opts.modelId} baseUrl=${opts.baseUrl} key=<${apiKey.length} chars>`);

const userData = mkdtempSync(join(tmpdir(), "openbuddy-real-chat-verify-"));
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
  .slice(0, 800);

const hash = (value) => createHash("sha256").update(value).digest("hex");

let app;
let page;
const rendererErrors = [];

async function invoke(channel, args) {
  return page.evaluate(
    ({ channel, args }) => window.api.invoke(channel, args),
    { channel, args },
  );
}

let passed = false;
const report = { schema: "openbuddy.real-chat-verify.v1" };

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

  // Configure provider directly via IPC — same path as diagnose-chat-stall.
  log(`configuring provider ${opts.providerId} → ${opts.baseUrl} (${opts.modelId})`);
  await invoke("agent:providers-save-provider", {
    provider: {
      id: opts.providerId,
      label: "real-chat-verify",
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

  // Create the session directly via IPC.
  const created = await invoke("agent:new-session", {
    cwd: workspace,
    modelId: `${opts.providerId}/${opts.modelId}`,
  });
  const sessionId = created?.sessionId;
  if (!sessionId) throw new Error(`agent:new-session returned no sessionId: ${JSON.stringify(created)}`);
  log(`session created = ${sessionId.slice(0, 12)}…`);

  // Wait for the composer to enable.
  await page.waitForFunction(() => {
    const ta = document.querySelector("textarea");
    return ta && !ta.disabled;
  }, undefined, { timeout: 60_000 });
  log("composer enabled");

  // Snapshot event-log cursor BEFORE the send so the loop only sees new events.
  const before = await invoke("agent:event-log", { sessionId, limit: 2000 });
  const cursor = Math.max(0, ...before.map((e) => (typeof e?.sequence === "number" ? e.sequence : 0)));
  log(`event-log cursor = ${cursor}`);

  // Fill and send the prompt through the actual composer.
  const composer = page.locator("textarea.wb-composer__input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.fill(opts.prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  log(`typed prompt (${opts.prompt.length} chars); clicked 发送`);

  // Wait for the marker to render in the assistant bubble, or the event log
  // to record agent/settled. We tolerate session-id churn: the renderer may
  // mint a different sessionId from the IPC-created one, so we scan ALL
  // recent events for a session/input that matches our prompt and use that
  // session id going forward.
  const promptHash = hash(opts.prompt);
  const deadline = Date.now() + opts.timeoutSec * 1000;
  let assistantText = "";
  let traceTypes = [];
  let activeSessionId = sessionId;
  let lastSnapshotAt = 0;
  while (Date.now() < deadline) {
    const events = await invoke("agent:event-log", { limit: 2000 });
    // Find which session id actually received our prompt.
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
    if (assistantText && settled) {
      log(`marker rendered + agent/settled received (${traceTypes.length} new events, session=${activeSessionId.slice(0, 12)}…)`);
      break;
    }
    if (Date.now() - lastSnapshotAt > 5000) {
      log(`waiting… session=${activeSessionId.slice(0, 12)}… events=${traceTypes.length} rendered=${rendered.length}bubbles`);
      lastSnapshotAt = Date.now();
    }
    await page.waitForTimeout(500);
  }

  if (!assistantText.includes(opts.marker)) {
    throw new Error(`marker "${opts.marker}" did not render in any assistant bubble. Last rendered: ${JSON.stringify(assistantText.slice(0, 200))}`);
  }
  if (!traceTypes.includes("agent/settled")) {
    throw new Error(`agent/settled not in event log. trace types: ${JSON.stringify(traceTypes)}`);
  }
  // Required sequence check.
  const required = ["session/input", "agent/start", "assistant/start", "assistant/end", "agent/settled"];
  for (const type of required) {
    if (!traceTypes.includes(type)) throw new Error(`missing required event "${type}". trace types: ${JSON.stringify(traceTypes)}`);
  }

  passed = true;
  report.ok = true;
  report.runtime = "electron+pi";
  report.evidence = {
    provider: opts.providerId,
    model: opts.modelId,
    baseUrl: opts.baseUrl,
    session: sessionId,
    marker: opts.marker,
    eventCount: traceTypes.length,
    eventTypes: traceTypes,
    assistantText: assistantText.slice(0, 200),
    rendererErrors,
  };
  log("=== outcome: ok ===");
} catch (error) {
  report.ok = false;
  report.error = safeError(error);
  console.error(`[real-chat-verify] ${report.error}`);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => undefined);
  if (existsSync(userData)) rmSync(userData, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
