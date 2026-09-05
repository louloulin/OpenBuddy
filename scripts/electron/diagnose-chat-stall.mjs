/**
 * diagnose-chat-stall.mjs — instrumented single-turn real-model chat probe.
 *
 * `real-ui-smoke.mjs` is thorough but silent: it runs four conversational
 * turns with a 180s `waitForTrace` budget each, plus a renderer reload and a
 * full Electron restart, and prints nothing until it either finishes or
 * throws. When a turn stalls there is no way to tell "the model is slow"
 * from "the stream died" from "the renderer never painted".
 *
 * This probe does ONE turn and narrates every layer once per second:
 *
 *   - `pi://update` / `pi://complete` / `pi://error` events seen by the renderer
 *   - the pi event log (`agent:event-log`) types
 *   - what the transcript DOM actually shows (`.msg--assistant`)
 *   - the store's streaming flag
 *   - renderer console errors
 *
 * so the exact layer that stops advancing is visible in the timeline.
 *
 * Credentials come from `scripts/lib/e2e-credentials.mjs` (environment →
 * `.env.e2e.local` → `~/.pi/agent/auth.json`), shared with
 * `run-minimax-real-ui.mjs` and `playwright.config.ts`. Provider/model are configured over IPC rather
 * than through the Settings dialog — the dialog path is already covered by
 * `real-ui-smoke.mjs`, and skipping it removes ~15s and a class of unrelated
 * failures from the diagnosis.
 *
 * Usage:
 *   node scripts/electron/diagnose-chat-stall.mjs
 *   node scripts/electron/diagnose-chat-stall.mjs --prompt "..." --timeout 120
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  prompt: "只回复这一个词：DIAG-OK",
  marker: "DIAG-OK",
  timeoutSec: 150,
  /**
   * Thinking level to request via `agent:set-thinking-level`.
   *
   * `off` keeps the probe on the plain text path. Setting `low`/`medium`/`high`
   * is how you exercise the `agent_thought_chunk` channel: reasoning is a
   * separate renderer channel from `agent_message_chunk`, and it stays
   * completely unexercised at `off` — so a bug in thought routing is invisible
   * unless this is turned on.
   */
  thinking: "off",
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
    else if (arg === "--thinking") out.thinking = next();
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));

/**
 * Shared resolver (environment → `.env.e2e.local` → `~/.pi/agent/auth.json`)
 * so this probe, the Playwright specs, and `run-minimax-real-ui.mjs` all
 * exercise the same credential and host.
 */
const credentials = resolveE2ECredentials({ provider: opts.provider });
if (!credentials.apiKey) {
  console.error(`[diagnose-chat-stall] ${describeSource(credentials)}`);
  process.exit(1);
}
const apiKey = credentials.apiKey;
if (opts.baseUrl === DEFAULTS.baseUrl) opts.baseUrl = credentials.baseUrl;
if (opts.modelId === DEFAULTS.modelId) opts.modelId = credentials.modelId;
const t0 = Date.now();
const ts = () => `+${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6)}s`;
const log = (...args) => console.log(ts(), ...args);

log(`credentials: ${describeSource({ ...credentials, ...opts })}`);

const userData = mkdtempSync(join(tmpdir(), "openbuddy-diag-"));
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

const redact = (s) => String(s ?? "").split(apiKey).join("[redacted]").slice(0, 400);

let app;
let page;
const consoleErrors = [];
/** Renderer-side `[OpenBuddy]` stream traces, in arrival order. */
const streamTrace = [];

async function invoke(channel, args) {
  return page.evaluate(
    ({ channel, args }) => window.api.invoke(channel, args),
    { channel, args },
  );
}

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
    if (m.type() === "error") consoleErrors.push(redact(m.text()));
  });
  page.on("pageerror", (e) => consoleErrors.push(redact(e.message)));
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  log("renderer attached");

  // Turn on the app's own stream tracing. `useAgentSession.ts` reads
  // `openbuddy.debug.stream` at MODULE LOAD time, so the flag has to be set
  // before the bundle evaluates — i.e. before the reload below, not now.
  await page.evaluate(() => localStorage.setItem("openbuddy.debug.stream", "1"));

  // Mirror the renderer's own `[OpenBuddy]` traces into our timeline.
  page.on("console", (m) => {
    const text = m.text();
    if (text.includes("[OpenBuddy]")) streamTrace.push({ at: Date.now(), text: redact(text) });
  });

  log(`configuring provider ${opts.providerId} → ${opts.baseUrl} (${opts.modelId})`);
  await invoke("agent:providers-save-provider", {
    provider: {
      id: opts.providerId,
      label: "diag",
      providerKind: "custom_anthropic",
      apiKey,
      baseUrl: opts.baseUrl,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  await invoke("agent:providers-save-model", {
    // Register the model as reasoning-capable when a thinking level is
    // requested; without `reasoning: true` pi clamps setThinkingLevel to "off"
    // and the agent_thought_chunk channel never fires.
    model: {
      providerId: opts.providerId,
      modelId: opts.modelId,
      name: opts.modelId,
      contextWindow: 128000,
      reasoning: opts.thinking !== "off",
    },
  });
  const auth = await invoke("agent:auth-status");
  log("auth-status.ready =", auth?.ready);

  const session = await invoke("agent:new-session", {
    cwd: workspace,
    modelId: `${opts.providerId}/${opts.modelId}`,
  });
  const sessionId = session?.sessionId;
  log("session =", sessionId ? `${sessionId.slice(0, 8)}…` : "(none)");
  const current = await invoke("agent:current-model");
  log("current-model =", JSON.stringify({ id: current?.id, provider: current?.provider }));

  if (opts.thinking && opts.thinking !== "off") {
    const applied = await invoke("agent:set-thinking-level", { level: opts.thinking });
    log(`thinking-level requested=${opts.thinking} applied=${JSON.stringify(applied)}`);
  }

  // Reload so the renderer's cold-start model list picks up the new provider,
  // then re-attach the capture (page.evaluate state is lost across reload).
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  // Re-arm the capture after reload, this time recording the ORDER and the
  // identifying fields. Counts alone can't show an interleaving bug (e.g. a
  // `complete` landing between chunks, or chunks addressed to a session the
  // view isn't bound to), which is exactly what we're hunting.
  await page.evaluate(() => {
    const w = window;
    w.__diag = { seq: [], updates: [], completes: [], errors: [] };
    // Record EVERY part type, not just `text`. `useAgentSession` treats both
    // `text_delta` and legacy `text` parts as appendable deltas, so filtering
    // to one shape hides a double-append.
    const partsOf = (p) => (Array.isArray(p?.content) ? p.content : [])
      .map((c) => `${c?.type ?? "?"}:${JSON.stringify(c?.text ?? "")}`)
      .join(" | ");
    const textOf = (p) => (Array.isArray(p?.content) ? p.content : [])
      .filter((c) => c?.type === "text" || c?.type === "text_delta")
      .map((c) => c.text ?? "")
      .join("");
    w.api.events.on("pi://update", (p) => {
      const entry = { at: Date.now(), kind: "update", type: p?.type, sessionId: p?.sessionId, chars: textOf(p).length, text: textOf(p).slice(0, 80), parts: partsOf(p) };
      w.__diag.seq.push(entry);
      w.__diag.updates.push(entry);
      if (p?.type === "agent_thought_chunk") (w.__diag.thoughts ??= []).push(entry);
    });
    w.api.events.on("pi://complete", (p) => {
      const entry = { at: Date.now(), kind: "complete", sessionId: p?.sessionId, stopReason: p?.stopReason };
      w.__diag.seq.push(entry);
      w.__diag.completes.push(entry);
    });
    w.api.events.on("pi://error", (p) => {
      const entry = { at: Date.now(), kind: "error", sessionId: p?.sessionId, error: String(p?.error ?? p) };
      w.__diag.seq.push(entry);
      w.__diag.errors.push(entry);
    });
  });
  log("reloaded, capture re-armed (ordered)");

  /**
   * Read the session the UI is actually bound to. `handleSendNew` mints its
   * own session via `optimisticSession.ensureNewSession()` rather than
   * reusing the one we created over IPC, so polling the IPC session's event
   * log would always show an idle session and `settled` would never be true.
   */
  const readUiSession = () => page.evaluate(() => {
    try {
      const v = JSON.parse(localStorage.getItem("openbuddy.active-session") ?? "null");
      return v && typeof v.sessionId === "string" ? v.sessionId : null;
    } catch { return null; }
  });

  const composer = page.locator("textarea.wb-composer__input").first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  const enabled = await page.waitForFunction(
    () => {
      const t = document.querySelector("textarea.wb-composer__input");
      return t && !t.disabled;
    },
    undefined,
    { timeout: 60_000 },
  ).then(() => true).catch(() => false);
  log("composer enabled =", enabled);
  if (!enabled) throw new Error("composer never became enabled — apiReady stayed false");

  await composer.fill(opts.prompt);
  log(`typed prompt (${opts.prompt.length} chars); clicking 发送`);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const sentAt = Date.now();

  // ---- Narrate every layer once per second until the marker renders. ----
  const deadline = Date.now() + opts.timeoutSec * 1000;
  let lastLine = "";
  let outcome = "timeout";
  while (Date.now() < deadline) {
    const snap = await page.evaluate(() => {
      const d = window.__diag ?? { updates: [], completes: [], errors: [] };
      const counts = {};
      for (const u of d.updates) counts[u.type ?? "?"] = (counts[u.type ?? "?"] ?? 0) + 1;
      const assistants = [...document.querySelectorAll(".msg--assistant")].map((n) => n.innerText ?? "");
      return {
        updateCount: d.updates.length,
        updateTypes: counts,
        completes: d.completes.length,
        errors: d.errors.slice(0, 3),
        lastUpdateAgoMs: d.updates.length ? Date.now() - d.updates[d.updates.length - 1].at : null,
        assistantCount: assistants.length,
        assistantChars: assistants.reduce((n, t) => n + t.length, 0),
        assistantTail: (assistants[assistants.length - 1] ?? "").slice(-120),
        assistantBody: assistants[assistants.length - 1] ?? "",
        loadingRow: Boolean(document.querySelector(".chatview__loading, .loading-row, [data-testid=loading-row]")),
        stopButton: Boolean(document.querySelector('[aria-label="停止生成"]')),
      };
    });

    let evLog = [];
    try {
      const pollSession = (await readUiSession()) ?? sessionId;
      evLog = await invoke("agent:event-log", { sessionId: pollSession, limit: 500 });
    } catch { /* session may not be queryable yet */ }
    const evTypes = Array.isArray(evLog) ? evLog.map((e) => e?.type) : [];
    const settled = evTypes.includes("agent/settled");

    const line = [
      `upd=${snap.updateCount}`,
      `types=${JSON.stringify(snap.updateTypes)}`,
      `done=${snap.completes}`,
      `idle=${snap.lastUpdateAgoMs ?? "-"}ms`,
      `dom=${snap.assistantCount}msg/${snap.assistantChars}ch`,
      `stop=${snap.stopButton ? "Y" : "n"}`,
      `ev=${evTypes.length}`,
      `settled=${settled ? "Y" : "n"}`,
    ].join(" ");
    if (line !== lastLine) {
      log(line);
      if (snap.assistantTail) log("      tail:", JSON.stringify(snap.assistantTail));
      lastLine = line;
    }
    if (snap.errors.length) {
      log("!! pi://error:", JSON.stringify(snap.errors));
      outcome = "pi-error";
      break;
    }
    // Substring matching is NOT good enough for streaming text. A duplicate-
    // append bug rendered "DIDIAG-OKAG-OK", which `.includes("DIAG-OK")`
    // happily accepted — the assertion passed while the transcript was
    // visibly corrupted. Require the marker to appear EXACTLY ONCE.
    const occurrences = snap.assistantTail.split(opts.marker).length - 1;
    if (occurrences >= 1 && settled) {
      const clean = occurrences === 1 && !/(.{3,})\1/.test(snap.assistantBody ?? "");
      outcome = clean ? "ok" : "corrupted";
      log(
        `MARKER RENDERED ×${occurrences} + settled after ${((Date.now() - sentAt) / 1000).toFixed(1)}s` +
        (clean ? "" : "  ← DUPLICATED/CORRUPTED TEXT"),
      );
      break;
    }
    await page.waitForTimeout(1000);
  }

  // ---- Final forensic dump ----
  log("=== outcome:", outcome, "===");

  // The UI does NOT reuse the session we created over IPC: `handleSendNew`
  // calls `optimisticSession.ensureNewSession()` and mints its own. So the
  // session the transcript is actually bound to has to be read back from
  // where the app persists it, or every event-log query below inspects an
  // unrelated, empty session.
  const uiSession = await page.evaluate(() => {
    try {
      const v = JSON.parse(localStorage.getItem("openbuddy.active-session") ?? "null");
      return v && typeof v.sessionId === "string" ? v.sessionId : null;
    } catch { return null; }
  });
  log("IPC-created session :", sessionId);
  log("UI active session   :", uiSession);
  if (uiSession && uiSession !== sessionId) {
    log("NOTE: UI minted its own session — the two differ.");
  }

  for (const [label, sid] of [["ipc", sessionId], ["ui", uiSession]]) {
    if (!sid) continue;
    const l = await invoke("agent:event-log", { sessionId: sid, limit: 500 }).catch(() => []);
    log(`event-log[${label}] types:`, JSON.stringify((Array.isArray(l) ? l : []).map((e) => e?.type)));
  }

  const seq = await page.evaluate(() => window.__diag?.seq ?? []);
  log("ordered event sequence:");
  for (const e of seq) {
    log(`   ${String(((e.at - sentAt) / 1000).toFixed(2)).padStart(6)}s ${e.kind}` +
      `${e.type ? "/" + e.type : ""} sess=${String(e.sessionId ?? "-").slice(0, 8)}` +
      `${e.chars !== undefined ? ` chars=${e.chars}` : ""}` +
      `${e.parts ? ` parts=[${e.parts}]` : ""}` +
      `${e.stopReason ? ` stop=${e.stopReason}` : ""}` +
      `${e.error ? ` err=${e.error.slice(0, 120)}` : ""}`);
  }

  if (streamTrace.length) {
    log(`renderer [OpenBuddy] traces (${streamTrace.length}, first 40):`);
    for (const t of streamTrace.slice(0, 40)) {
      log(`   ${String(((t.at - sentAt) / 1000).toFixed(2)).padStart(6)}s ${t.text.slice(0, 220)}`);
    }
  }
  const final = await page.evaluate(() => ({
    assistants: [...document.querySelectorAll(".msg--assistant")].map((n) => (n.innerText ?? "").slice(0, 300)),
    users: [...document.querySelectorAll(".msg--user")].map((n) => (n.innerText ?? "").slice(0, 120)),
    updates: (window.__diag?.updates ?? []).map((u) => u.type),
    thoughtChunks: (window.__diag?.thoughts ?? []).length,
    // A reasoning block renders as <details class="msg__thought">; its body
    // must NOT also appear in the answer body (.msg__body). This surfaces the
    // "reasoning leaked into the answer" regression directly from the DOM.
    thoughtBlocks: [...document.querySelectorAll(".msg__thought")].map((n) => (n.innerText ?? "").slice(0, 160)),
    answerBodies: [...document.querySelectorAll(".msg--assistant .msg__body")].map((n) => (n.innerText ?? "").slice(0, 200)),
  }));
  log("user bubbles:", JSON.stringify(final.users));
  log("assistant bubbles:", JSON.stringify(final.assistants));
  log("pi://update type stream:", JSON.stringify(final.updates));
  log(`agent_thought_chunk count: ${final.thoughtChunks}`);
  if (final.thoughtBlocks.length) log("thought blocks (.msg__thought):", JSON.stringify(final.thoughtBlocks));
  if (consoleErrors.length) log("renderer console errors:", JSON.stringify(consoleErrors.slice(0, 10)));
  else log("renderer console errors: none");

  await page.screenshot({ path: join(ROOT, "evidence", `diag-chat-${outcome}.png`) }).catch(() => {});
  process.exitCode = outcome === "ok" ? 0 : 1;
} catch (error) {
  log("FATAL:", redact(error?.stack ?? error?.message ?? error));
  if (consoleErrors.length) log("renderer console errors:", JSON.stringify(consoleErrors.slice(0, 10)));
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
}
