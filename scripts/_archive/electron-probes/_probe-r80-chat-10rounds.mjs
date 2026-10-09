/**
 * R80 v3 — AI Chat 真机 10 轮对话验证(MiniMax 真模型)
 *
 * 真机事件契约(读自 src/lib/agent/pi-client.ts + electron/main/pi-stream-transport.ts):
 *   - 流式 chunk: window.api.events.on("pi://update", h) → SessionUpdate
 *       agent_message_chunk 的 content[] 是 { type:"text_delta", text } | { type:"text_start" } | { type:"text_end", content }
 *       另有 openPiStream(MessagePort) 批量通道,本探针用 IPC 通道保证不丢事件。
 *   - 完成信号: window.api.events.on("pi://complete", h) → PromptComplete { sessionId, stopReason }
 *   - 失败信号: window.api.events.on("pi://turn-error", h)
 *
 * Provider 必须真注册(否则 pi 会回落到 ~/.pi/agent/auth.json 里的旧 key → 429):
 *   1. 写 pi-agent/{models.json,auth.json} 空壳 + 设 PI_CODING_AGENT_DIR
 *   2. 清洗环境里的 ANTHROPIC_* / OPENAI_* 等 ambient 凭证
 *   3. agent:providers-save-provider + agent:providers-save-model
 *   4. agent:new-session { cwd, modelId: "minimax/MiniMax-M3" }
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  REPO_ROOT as root,
  describeSource,
  resolveE2ECredentials,
  scrubProviderCredentials,
} from "../lib/e2e-credentials.mjs";

const credentials = resolveE2ECredentials({});
const apiKey = credentials.apiKey;
const baseUrl = credentials.baseUrl;
const modelId = credentials.modelId;
const providerId = "minimax";

const report = {
  ok: false,
  credentialSource: describeSource(credentials),
  apiKeyPresent: Boolean(apiKey),
  baseUrl,
  modelId,
  providerId,
  rounds: [],
  pageErrors: [],
  consoleErrors: [],
};

console.log(`[r80] ${describeSource(credentials)}`);
if (!apiKey) {
  console.log(JSON.stringify({ ...report, error: "no api key resolved" }, null, 2));
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const userData = mkdtempSync(join(tmpdir(), "ob-r80-"));
const piAgentDir = join(userData, "pi-agent");
const workspace = join(userData, "workspace");
mkdirSync(piAgentDir, { recursive: true });
mkdirSync(workspace, { recursive: true });
// 空壳:让 pi 不要读真实用户 ~/.pi/agent(那里的 key 可能已耗尽)
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

const childEnv = scrubProviderCredentials(process.env);
Object.assign(childEnv, {
  ELECTRON_RENDERER_URL: "",
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_DEBUG_UI: "0",
  OPENBUDDY_HARNESS_FILE: "",
});

const redact = (s) => String(s ?? "").split(apiKey).join("[redacted]").slice(0, 500);

let app;
let page;

try {
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, root],
    executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron"),
    cwd: root,
    timeout: 90_000,
    env: childEnv,
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => report.pageErrors.push(redact(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error") report.consoleErrors.push(redact(m.text()));
  });
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 60_000 });
  await sleep(2000);

  // 关 onboarding(reload 生效,R77 排查过的真因)
  await page.evaluate(() => {
    const done = JSON.stringify({
      version: 1, status: "done", index: 0, steps: [],
      startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    });
    window.localStorage.setItem("openbuddy.onboarding.state", done);
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  await sleep(2000);

  const invoke = (channel, args) =>
    page.evaluate(({ channel, args }) => window.api.invoke(channel, args), { channel, args });

  // 1) 真注册 provider(关键:否则用 ambient/旧 key → 429)
  await invoke("agent:providers-save-provider", {
    provider: {
      id: providerId,
      label: "r80-minimax",
      providerKind: "custom_anthropic",
      apiKey,
      baseUrl,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  await invoke("agent:providers-save-model", {
    model: {
      providerId,
      modelId: modelId.includes("/") ? modelId.split("/").slice(1).join("/") : modelId,
      name: modelId,
      contextWindow: 128000,
      reasoning: false,
    },
  });
  const auth = await invoke("agent:auth-status");
  report.authStatus = { ready: auth?.ready };

  // 2) 新 session 绑定该模型
  const fullModelId = modelId.includes("/") ? modelId : `${providerId}/${modelId}`;
  const session = await invoke("agent:new-session", { cwd: workspace, modelId: fullModelId });
  const sessionId = session?.sessionId;
  if (!sessionId) throw new Error("agent:new-session returned no sessionId: " + JSON.stringify(session));
  report.sessionId = sessionId;
  report.boundModelId = fullModelId;

  const current = await invoke("agent:current-model");
  report.currentModel = { id: current?.id, provider: current?.provider };

  // reload 让 renderer 冷启动拉到新 provider,然后重新挂事件捕获
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  await sleep(1500);

  await page.evaluate(() => {
    const w = window;
    w.__r80 = { updates: [], completes: [], errors: [], text: "", seq: [] };
    const textOf = (p) => (Array.isArray(p?.content) ? p.content : [])
      .filter((c) => c?.type === "text" || c?.type === "text_delta")
      .map((c) => c.text ?? "")
      .join("");
    const isTextEnd = (p) => (Array.isArray(p?.content) ? p.content : [])
      .some((c) => c?.type === "text_end" || c?.type === "text");
    w.api.events.on("pi://update", (p) => {
      const chunk = textOf(p);
      if (p?.type === "agent_message_chunk" && chunk) {
        // text_end 携带整块 content,不重复追加(避免双计)
        const parts = Array.isArray(p.content) ? p.content : [];
        const deltaOnly = parts.filter((c) => c?.type === "text_delta").map((c) => c.text ?? "").join("");
        if (deltaOnly) w.__r80.text += deltaOnly;
        w.__r80.updates.push({ at: Date.now(), type: p.type, len: chunk.length });
      } else {
        w.__r80.updates.push({ at: Date.now(), type: p?.type });
      }
      w.__r80.seq.push({ at: Date.now(), kind: "update", type: p?.type, sid: p?.sessionId });
      void isTextEnd;
    });
    w.api.events.on("pi://complete", (p) => {
      w.__r80.completes.push({ at: Date.now(), sessionId: p?.sessionId, stopReason: p?.stopReason });
      w.__r80.seq.push({ at: Date.now(), kind: "complete", stopReason: p?.stopReason, sid: p?.sessionId });
    });
    w.api.events.on("pi://turn-error", (p) => {
      w.__r80.errors.push({ at: Date.now(), detail: String(p?.detail ?? p?.error ?? JSON.stringify(p)).slice(0, 400) });
      w.__r80.seq.push({ at: Date.now(), kind: "turn-error", detail: String(p?.detail ?? "").slice(0, 200) });
    });
  });

  const PROMPTS = [
    "用一句话说 hi",
    "1+1 等于几?只回答数字",
    "把「你好」翻译成英文,一个词",
    "列出 3 种水果,只列名,用顿号分隔",
    "法国的首都是哪里?一个词",
    "5 的阶乘是多少?只回答数字",
    "写一句 10 个字以内的中文问候",
    "太阳从哪个方向升起?两个字",
    "一年有几个月?只回答数字",
    "用一句话说明什么是 HTTP",
  ];

  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    const roundStart = Date.now();

    await page.evaluate(() => {
      window.__r80.text = "";
      window.__r80.updates = [];
      window.__r80.completes = [];
      window.__r80.errors = [];
      window.__r80.seq = [];
    });

    const sendRes = await page.evaluate(async ({ sessionId, text }) => {
      try {
        await window.api.invoke("agent:prompt", { sessionId, text });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e).slice(0, 300) };
      }
    }, { sessionId, text: prompt });

    // 等 pi://complete(end_turn)或 turn-error,最多 90s
    const completed = await page.waitForFunction(
      (sinceTs) => {
        const r = window.__r80;
        if (!r) return false;
        return r.completes.some((c) => c.at >= sinceTs && (c.stopReason === "end_turn" || c.stopReason === "stop")) ||
               r.errors.some((e) => e.at >= sinceTs);
      },
      roundStart,
      { timeout: 90_000, polling: 200 },
    ).then(() => true).catch(() => false);

    const tail = await page.evaluate((since) => {
      const r = window.__r80 ?? {};
      const types = {};
      for (const u of (r.updates ?? [])) types[u.type ?? "?"] = (types[u.type ?? "?"] ?? 0) + 1;
      return {
        text: r.text ?? "",
        textLen: (r.text ?? "").length,
        types,
        stopReason: (r.completes ?? [])[0]?.stopReason ?? null,
        error: (r.errors ?? [])[0]?.detail ?? null,
        seqLen: (r.seq ?? []).length,
      };
    }, roundStart);

    report.rounds.push({
      i,
      prompt: prompt.slice(0, 40),
      sendOk: sendRes.ok,
      sendError: sendRes.error,
      elapsedMs: Date.now() - roundStart,
      updateTypes: tail.types,
      textLen: tail.textLen,
      text: tail.text.slice(0, 300),
      stopReason: tail.stopReason,
      error: tail.error,
      done: Boolean(completed) && tail.textLen > 0 && !tail.error,
    });

    if (!completed || tail.error) break;
  }

  report.doneCount = report.rounds.filter((r) => r.done).length;
  report.ok = report.doneCount === PROMPTS.length && report.pageErrors.length === 0;
} catch (err) {
  report.error = redact(String(err?.message ?? err));
} finally {
  try { await app.close(); } catch { /* */ }
  const json = JSON.stringify(report, null, 2);
  console.log(json);
  try {
    const { writeFileSync } = await import("node:fs");
    writeFileSync("/tmp/r80-report.json", json);
  } catch { /* */ }
  process.exit(report.ok ? 0 : 1);
}
