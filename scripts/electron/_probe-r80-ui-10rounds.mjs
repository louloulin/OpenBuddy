/**
 * R80-UI — AI Chat 真机 10 轮对话验证(**真实 UI 路径**)
 *
 * 与 R80 IPC 探针的区别:全程走用户真实操作路径
 *   1. 在真实 textarea.wb-composer__input 里逐字输入
 *   2. 点击真实的「发送」按钮(role=button name=发送)
 *   3. 等真实 DOM 里 .msg--assistant 渲染出非空正文
 *   4. 校验流式:存在「正文非空 且 pi://complete 未到」的采样点(与长度无关)
 *
 * Provider 真注册必须做(否则 pi 回落 ~/.pi/agent/auth.json 旧 key → 429),
 * 复用 scripts/lib/e2e-credentials.mjs 的 resolveE2ECredentials + scrubProviderCredentials。
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
const fullModelId = modelId.includes("/") ? modelId : `${providerId}/${modelId}`;

const report = {
  ok: false,
  credentialSource: describeSource(credentials),
  modelId,
  rounds: [],
  pageErrors: [],
  consoleErrors: [],
};
console.log(`[r80-ui] ${describeSource(credentials)}`);
if (!apiKey) { console.log(JSON.stringify({ ...report, error: "no api key" }, null, 2)); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s) => String(s ?? "").split(apiKey).join("[redacted]").slice(0, 400);

const userData = mkdtempSync(join(tmpdir(), "ob-r80ui-"));
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

let app, page;
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
  page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(redact(m.text())); });
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 60_000 });
  await sleep(2000);

  // 关 onboarding
  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 0, steps: [], startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  await sleep(2000);

  const invoke = (channel, args) => page.evaluate(({ channel, args }) => window.api.invoke(channel, args), { channel, args });

  // 注册 provider(真机 key)
  await invoke("agent:providers-save-provider", {
    provider: { id: providerId, label: "r80-ui", providerKind: "custom_anthropic", apiKey, baseUrl, apiBackend: "messages", authScheme: "x_api_key" },
  });
  await invoke("agent:providers-save-model", {
    model: { providerId, modelId: modelId.includes("/") ? modelId.split("/").slice(1).join("/") : modelId, name: modelId, contextWindow: 128000, reasoning: false },
  });
  report.authStatus = { ready: (await invoke("agent:auth-status"))?.ready };

  // reload 让 renderer 冷启动拉到新 provider
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  await sleep(2500);

  // 真流式证据:记录 .msg--assistant 文本长度随时间变化
  await page.evaluate(() => {
    const w = window;
    w.__r80ui = { samples: [], completes: [], errors: [], updates: 0 };
    w.api.events.on("pi://update", (p) => { w.__r80ui.updates += 1; });
    w.api.events.on("pi://complete", (p) => { w.__r80ui.completes.push({ at: Date.now(), stopReason: p?.stopReason }); });
    w.api.events.on("pi://turn-error", (p) => { w.__r80ui.errors.push({ at: Date.now(), detail: String(p?.detail ?? "").slice(0, 300) }); });
    // 200ms 采样 assistant 正文长度
    if (w.__r80uiTimer) clearInterval(w.__r80uiTimer);
    w.__r80uiTimer = setInterval(() => {
      const nodes = [...document.querySelectorAll(".msg--assistant .msg__body")];
      const last = nodes[nodes.length - 1];
      w.__r80ui.samples.push({
        at: Date.now(),
        count: nodes.length,
        len: last ? (last.innerText ?? "").length : 0,
        completed: (w.__r80ui.completes ?? []).length > 0,
      });
    }, 200);
  });

  const composer = page.locator("textarea.wb-composer__input").first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  const composerEnabled = await page.waitForFunction(
    () => { const t = document.querySelector("textarea.wb-composer__input"); return t && !t.disabled; },
    undefined, { timeout: 60_000 },
  ).then(() => true).catch(() => false);
  report.composerEnabled = composerEnabled;
  if (!composerEnabled) throw new Error("composer 一直是 disabled — apiReady=false,provider 没生效");

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
      window.__r80ui.samples = [];
      window.__r80ui.completes = [];
      window.__r80ui.errors = [];
      window.__r80ui.updates = 0;
    });

    // 记录本轮开始前已有的 assistant 节点数 —— 轮 N 必须等到"新增节点"才算数,
    // 否则会误把轮 N-1 的正文当成轮 N 的回复。
    const baselineAssistantCount = await page.evaluate(
      () => document.querySelectorAll(".msg--assistant").length,
    );

    // 真实输入(逐字,触发 React onChange)
    await composer.click();
    await composer.fill("");
    await composer.type(prompt, { delay: 8 });
    const typed = await composer.inputValue();

    // 等「发送」按钮(icon 按钮,aria-label="发送")回到可用状态,再点
    const sendBtn = page.locator('button[aria-label="发送"]').first();
    const sendReady = await page.waitForFunction(
      () => {
        const b = document.querySelector('button[aria-label="发送"]');
        if (!b) return false;
        const rect = b.getBoundingClientRect();
        return !b.disabled && rect.width > 0 && rect.height > 0;
      },
      undefined, { timeout: 60_000, polling: 150 },
    ).then(() => true).catch(() => false);
    if (!sendReady) throw new Error("发送按钮 60s 内未回到可用状态");
    await sendBtn.click();

    // 等本轮 assistant 正文非空(最多 60s)
    const gotText = await page.waitForFunction(
      ({ sinceTs, baseline }) => {
        const r = window.__r80ui;
        if (!r) return false;
        if (r.errors.some((e) => e.at >= sinceTs)) return true;
        const fresh = r.samples.filter((s) => s.at >= sinceTs);
        // 必须出现"比 baseline 更多"的 assistant 节点,且该节点正文非空
        return fresh.some((s) => s.count > baseline && s.len > 0);
      },
      { sinceTs: roundStart, baseline: baselineAssistantCount },
      { timeout: 60_000, polling: 150 },
    ).then(() => true).catch(() => false);

    // 等本轮的 pi://complete(turn 真正结束),而不是等"文本不变"——
    // reasoning 阶段「深度思考」占位会短暂稳定,仅看长度会把占位当成正文。
    const turnDone = await page.waitForFunction(
      (sinceTs) => (window.__r80ui?.completes ?? []).some((c) => c.at >= sinceTs),
      roundStart, { timeout: 90_000, polling: 150 },
    ).then(() => true).catch(() => false);
    // 再等一小段,让最后一帧 flush 到 DOM
    await sleep(500);

    const tail = await page.evaluate((since) => {
      const r = window.__r80ui ?? {};
      const fresh = (r.samples ?? []).filter((s) => s.at >= since);
      // 流式证据(与回答长度无关):在 pi://complete 到达**之前**,就已经
      // 采样到非空正文。这直接证明文本是边生成边渲染的,而不是等回合结束
      // 一次性塞进去。比"长度序列 ≥2 个不同值"稳 —— 后者对 "2" 这种
      // 单字符回答永远不成立(只有 0 → 1 一次跳变)。
      const renderedBeforeComplete = fresh.some((s) => s.len > 0 && !s.completed);
      const lens = fresh.map((s) => s.len);
      const distinct = [...new Set(lens)].filter((n) => n > 0);
      const nodes = [...document.querySelectorAll(".msg--assistant .msg__body")];
      const rawLast = nodes[nodes.length - 1]?.innerText ?? "";
      // 「深度思考」是 reasoning 折叠头,不算正文;取它之后的可见答案
      const last = rawLast.replace(/^深度思考\s*/u, "").trim();
      const userNodes = [...document.querySelectorAll(".msg--user .msg__bubble-text")];
      return {
        assistantCount: nodes.length,
        lastText: last,
        lastLen: last.length,
        userCount: userNodes.length,
        userLast: userNodes[userNodes.length - 1]?.innerText ?? "",
        distinctLengths: distinct.slice(0, 12),
        renderedBeforeComplete,
        sampleCount: fresh.length,
        updates: r.updates ?? 0,
        stopReason: (r.completes ?? [])[0]?.stopReason ?? null,
        error: (r.errors ?? [])[0]?.detail ?? null,
      };
    }, roundStart);

    report.rounds.push({
      i,
      prompt: prompt.slice(0, 40),
      typedOk: typed === prompt,
      elapsedMs: Date.now() - roundStart,
      assistantCount: tail.assistantCount,
      textLen: tail.lastLen,
      text: tail.lastText.slice(0, 200),
      userEchoed: tail.userLast.trim().length > 0 && tail.userLast.trim().includes(prompt.slice(0, 8)),
      streamingDistinctLens: tail.distinctLengths,
      renderedBeforeComplete: tail.renderedBeforeComplete,
      // 主证据:complete 之前就渲染出正文。次证据:观察到 ≥2 个不同的
      // 中间长度(长回答时的加分项,不作为必要条件)。
      isStreaming: tail.renderedBeforeComplete || tail.distinctLengths.length >= 2,
      updates: tail.updates,
      stopReason: tail.stopReason,
      turnDone,
      error: tail.error,
      done: tail.lastLen > 0 && !tail.error,
    });

    if (tail.error || tail.lastLen === 0) break;
  }

  report.doneCount = report.rounds.filter((r) => r.done).length;
  report.streamingRounds = report.rounds.filter((r) => r.isStreaming).length;
  report.ok = report.doneCount === PROMPTS.length && report.pageErrors.length === 0;
} catch (err) {
  report.error = redact(String(err?.message ?? err));
} finally {
  try { await app.close(); } catch { /* */ }
  const json = JSON.stringify(report, null, 2);
  console.log(json);
  try { const { writeFileSync } = await import("node:fs"); writeFileSync("/tmp/r80-ui-report.json", json); } catch { /* */ }
  process.exit(report.ok ? 0 : 1);
}
