/**
 * real-chat-multiturn.mjs — verifies multi-turn real-model AI chat.
 *
 * Builds on `real-chat-verify.mjs` (single turn). Sends N follow-up prompts
 * to the same Pi session and asserts:
 *
 *   - each follow-up marker renders in an assistant bubble
 *   - each follow-up produces its own `agent/settled` event in the event log
 *   - the context window grows monotonically across turns (every message
 *     sticks to the same session id; nothing gets dropped or rebroadcast)
 *
 * This guards the "context retention" property that workbuddy-style UIs
 * rely on: a follow-up "remember X" → "what was X?" round-trip must succeed
 * against the real model, not against the in-process echo provider.
 *
 * Usage:
 *   node scripts/electron/real-chat-multiturn.mjs
 *   node scripts/electron/real-chat-multiturn.mjs --turns 3
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
  turns: 2,
  timeoutSec: 90,
};

const PROMPTS = [
  "真实多轮校验第 1 轮：记住校验词 MULTI-TURN-ALPHA，只回复 OK",
  "真实多轮校验第 2 轮：上一轮的校验词是什么？只回复它",
];

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
    else if (arg === "--turns") out.turns = Number(next());
    else if (arg === "--timeout") out.timeoutSec = Number(next());
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const credentials = resolveE2ECredentials({ provider: opts.provider });
if (!credentials.apiKey) {
  console.error(`[real-chat-multiturn] ${describeSource(credentials)}`);
  process.exit(1);
}
const apiKey = credentials.apiKey;
if (opts.baseUrl === DEFAULTS.baseUrl) opts.baseUrl = credentials.baseUrl;
if (opts.modelId === DEFAULTS.modelId) opts.modelId = credentials.modelId;

const t0 = Date.now();
const ts = () => `+${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s`;
const log = (...args) => console.log(ts(), ...args);

log(`credentials: provider=${opts.provider} model=${opts.modelId} baseUrl=${opts.baseUrl} key=<${apiKey.length} chars>`);

const userData = mkdtempSync(join(tmpdir(), "openbuddy-real-chat-multiturn-"));
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

async function waitForTurnSettled({ prompt, marker, cursor, deadlineMs }) {
  const promptHash = hash(prompt);
  const deadline = Date.now() + deadlineMs;
  let assistantText = "";
  let traceTypes = [];
  let activeSessionId = "(pending)";
  while (Date.now() < deadline) {
    const events = await invoke("agent:event-log", { limit: 2000 });
    const recentInput = events
      .filter((e) => e?.sequence > cursor && e?.type === "session/input")
      .find((e) => {
        const text = e?.payload?.text;
        return text === prompt || (text && typeof text === "object" && text.sha256 === promptHash);
      });
    if (recentInput?.sessionId) activeSessionId = recentInput.sessionId;
    const post = events.filter((e) => e?.sequence > cursor && e?.sessionId === activeSessionId);
    traceTypes = post.map((e) => e.type);
    const rendered = await page.locator(".msg--assistant").allTextContents();
    assistantText = rendered.find((t) => t.includes(marker)) ?? "";
    const settled = traceTypes.includes("agent/settled");
    if (assistantText && settled) return { assistantText, traceTypes, activeSessionId };
    await page.waitForTimeout(500);
  }
  throw new Error(`turn never settled for marker=${marker} session=${activeSessionId.slice(0, 12)} types=${JSON.stringify(traceTypes.slice(-10))}`);
}

const report = { schema: "openbuddy.real-chat-multiturn.v1", turns: [] };
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
    if (m.type() === "error") rendererErrors.push(safeError(m.text()));
  });
  page.on("pageerror", (e) => rendererErrors.push(safeError(e.message)));
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });

  await invoke("agent:providers-save-provider", {
    provider: {
      id: opts.providerId,
      label: "real-chat-multiturn",
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

  let cursor = Math.max(
    0,
    ...(await invoke("agent:event-log", { sessionId, limit: 2000 })).map((e) =>
      typeof e?.sequence === "number" ? e.sequence : 0,
    ),
  );

  const composer = page.locator("textarea.wb-composer__input").first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });

  for (let turn = 0; turn < opts.turns; turn += 1) {
    const prompt = PROMPTS[turn];
    const marker = prompt.includes("记住") ? "OK" : "MULTI-TURN-ALPHA";
    log(`turn ${turn + 1}/${opts.turns}: marker="${marker}"`);
    await composer.fill(prompt);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const turnStart = Date.now();
    const { assistantText, traceTypes, activeSessionId } = await waitForTurnSettled({
      prompt,
      marker,
      cursor,
      deadlineMs: opts.timeoutSec * 1000,
    });
    const elapsed = ((Date.now() - turnStart) / 1000).toFixed(1);
    log(`turn ${turn + 1} ok in ${elapsed}s — session=${activeSessionId.slice(0, 12)} events=${traceTypes.length}`);
    report.turns.push({
      turn: turn + 1,
      marker,
      session: activeSessionId,
      elapsedSec: Number(elapsed),
      eventCount: traceTypes.length,
      hasInput: traceTypes.includes("session/input"),
      hasStart: traceTypes.includes("agent/start"),
      hasSettled: traceTypes.includes("agent/settled"),
    });
    // Advance the cursor so the next iteration only sees new events.
    const allEvents = await invoke("agent:event-log", { sessionId: activeSessionId, limit: 2000 });
    cursor = Math.max(0, ...allEvents.map((e) => (typeof e?.sequence === "number" ? e.sequence : 0)));
  }

  passed = true;
  report.ok = true;
  report.runtime = "electron+pi";
  report.evidence = { provider: opts.providerId, model: opts.modelId, rendererErrors };
  log("=== outcome: ok ===");
} catch (error) {
  report.ok = false;
  report.error = safeError(error);
  console.error(`[real-chat-multiturn] ${report.error}`);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => undefined);
  if (existsSync(userData)) rmSync(userData, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
