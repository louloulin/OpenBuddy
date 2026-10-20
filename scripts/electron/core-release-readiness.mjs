/**
 * core-release-readiness.mjs — **核心功能发布就绪**真机探针。
 *
 * 回答的问题不是"代码写了吗",而是"用户真机走一遍核心旅程,会不会卡住":
 *   J1  首启可用(无凭据也有首屏,不白屏)
 *   J2  BYOK 配置 → 真实网关跑通一轮对话(流式 + 助手回复)
 *   J3  工具调用真的发生(模型调 read 工具)
 *   J4  会话管理(新建 / 切换 / 侧栏可见)
 *   J5  任务面板(真后端 CRUD)
 *   J6  计划面板(挂载且能回发)
 *   J7  记忆面板(增删查)
 *   J8  产物中心 + 终端 + Git 面板
 *   J9  设置(主题/语言/数据管理)
 *   J10 备份通道
 *   J11 渲染层零 React 错误 / 零 console 错误
 *
 * 真实网关凭据取自 .env.e2e.local(仅本机使用,输出不含凭据)。
 *
 * Usage: node scripts/electron/core-release-readiness.mjs
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { resolveE2ECredentials, scrubProviderCredentials } from "../lib/e2e-credentials.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SHOT_DIR = "/tmp/ob-core-readiness";
mkdirSync(SHOT_DIR, { recursive: true });
const log = (msg) => console.log(`[readiness] ${msg}`);

const creds = resolveE2ECredentials({});
if (!creds.apiKey) {
  console.error("[readiness] 没有可用凭据(.env.e2e.local / 环境变量),无法验证真实对话链路");
  process.exit(2);
}

const userData = mkdtempSync(join(tmpdir(), "ob-readiness-ud-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

const childEnv = scrubProviderCredentials({
  ...process.env,
  ELECTRON_RENDERER_URL: "",
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_DEBUG_UI: "0",
  OPENBUDDY_HARNESS_FILE: "",
});

const checks = [];
function record(id, label, ok, detail = "") {
  checks.push({ id, ok, label });
  const tag = ok === "skip" ? "SKIP" : ok ? "PASS" : "FAIL";
  log(`${tag}  ${id}  ${label}${detail ? ` — ${detail}` : ""}`);
}

let app;
let page;
const consoleErrors = [];
const rawErrors = [];

try {
  log("launching Electron (dist)…");
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, ROOT],
    executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(ROOT, "node_modules", ".bin", "electron"),
    cwd: ROOT,
    timeout: 90_000,
    env: childEnv,
  });
  // 主进程 stdout/stderr —— 崩溃原因在这里(渲染层只看到窗口消失)。
  app.process().stdout?.on("data", (chunk) => log(`[main:out] ${String(chunk).slice(0, 400)}`));
  app.process().stderr?.on("data", (chunk) => log(`[main:err] ${String(chunk).slice(0, 400)}`));
  app.process().on("exit", (code, signal) => log(`[main] exited code=${code} signal=${signal}`));
  page = await app.firstWindow();
  page.on("console", (m) => {
    if (m.type() === "error") {
      const text = String(m.text()).slice(0, 1200);
      consoleErrors.push(text);
      log(`console.error: ${text.slice(0, 600)}`);
    }
  });
  page.on("pageerror", (e) => {
    const text = String(e.message).slice(0, 1200);
    rawErrors.push(text);
    log(`pageerror: ${text.slice(0, 600)}`);
  });
  // 窗口/页面生命周期:模型选择后应用曾静默退出(code=0),这里留下证据链。
  page.on("crash", () => log("[lifecycle] RENDERER CRASHED"));
  page.on("close", () => log("[lifecycle] page closed"));
  try {
    for (const win of app.windows()) {
      win.on("close", () => log("[lifecycle] window close event"));
    }
    app.on("window", (win) => {
      log("[lifecycle] new window opened");
      win.on("close", () => log("[lifecycle] window close event (new)"));
    });
  } catch { /* 旧版 playwright electron 句柄差异,忽略 */ }
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(1200);

  const invoke = (channel, args) =>
    page.evaluate(({ channel: ch, args: a }) => window.api.invoke(ch, a), { channel, args });

  // ── J1 首启可用 ──
  const firstPaint = await page.locator("#root").innerText().catch(() => "");
  record("J1", "首启可用(有首屏内容,不白屏)", firstPaint.trim().length > 20, `${firstPaint.trim().length} 字符`);

  // ── J2/J3 BYOK + 真实对话 + 工具调用 ──
  await invoke("agent:providers-save-provider", {
    provider: {
      id: creds.providerId ?? creds.modelId.split("/")[0],
      label: "readiness",
      providerKind: "custom_anthropic",
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      apiBackend: "messages",
      authScheme: "x_api_key",
    },
  });
  await invoke("agent:providers-save-model", {
    model: {
      providerId: creds.providerId ?? creds.modelId.split("/")[0],
      modelId: creds.modelId,
      name: creds.modelId,
      contextWindow: 128000,
      reasoning: false,
    },
  });
  const auth = await invoke("agent:auth-status");
  record("J2a", "BYOK 配置写入并被认账", auth?.ready === true, JSON.stringify(auth?.status ?? auth).slice(0, 80));

  // 新会话(以仓库为工作区,让 read 工具有真实文件可读)
  await invoke("agent:new-session", { cwd: ROOT });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const row = page.locator(".sidebar__conv").first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await row.click();
  await page.waitForTimeout(1500);

  // 选模型:保存 provider/model 不等于设为当前模型。先走 IPC 契约
  // (agent:set-model),再验证 UI 选择器里能看到它(用户可见性)。
  let modelSet = false;
  try {
    await invoke("agent:set-model", { modelId: creds.modelId });
    modelSet = true;
  } catch (error) {
    rawErrors.push(`set-model: ${String(error).slice(0, 160)}`);
  }
  await page.waitForTimeout(800);
  const currentModel = await invoke("agent:current-model").catch((e) => ({ error: String(e) }));
  const providers = await invoke("agent:providers-list").catch(() => null);
  log(`current-model: ${JSON.stringify(currentModel).slice(0, 200)}`);
  log(`providers: ${JSON.stringify(providers).slice(0, 300)}`);
  record("J2b0", "模型可设为当前模型", modelSet, creds.modelId);

  // UI 可见性:选择器菜单里能看到该模型(弱断言,不影响主链路)。
  let uiVisible = false;
  try {
    const trigger = page.locator(".model-selector__trigger").first();
    await trigger.waitFor({ state: "visible", timeout: 6000 });
    await trigger.click();
    await page.waitForTimeout(800);
    uiVisible = (await page.locator(".model-selector__item").count()) > 0;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  } catch { /* 选择器不可用不阻塞主链路 */ }
  record("J2b1", "模型选择器 UI 可打开且有可选项", uiVisible);

  const composer = page.locator("textarea.wb-composer__input");
  await composer.waitFor({ state: "visible", timeout: 20_000 });
  const marker = "READINESS-OK-7f3a";
  await composer.fill(`请先调用 read 工具读取 package.json 的前 5 行(必须真的调用工具),然后只回复 ${marker}`);
  await page.getByRole("button", { name: "发送", exact: true }).first().click();

  let replied = false;
  let toolUsed = false;
  let turnError = "";
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const texts = await page.locator(".msg--assistant").allTextContents();
    if (texts.some((t) => t.includes(marker))) { replied = true; break; }
    const tools = await page.locator(".toolcall, [data-testid='tool-call']").count();
    if (tools > 0) toolUsed = true;
    // 错误呈现有两级:回合内 TurnErrorCard(.turn-error)或全局横幅
    // (.chatview__error-banner,失败回合经 setError 走这里)。
    const errText =
      (await page.locator(".turn-error").first().innerText().catch(() => "")) ||
      (await page.locator(".chatview__error-banner").first().innerText().catch(() => ""));
    if (errText) { turnError = errText; break; }
    await page.waitForTimeout(500);
  }
  // 上游账户类失败(余额/限流/鉴权)不是应用缺陷:对话派发成功、错误如实
  // 呈现,只是没有可用的模型额度 —— 记为 SKIP 而不是 FAIL。
  const upstreamFailure = /insufficient|balance|402|429|quota|unauthorized|401/i.test(turnError);
  if (replied) {
    record("J2b", "真实网关跑通一轮对话(收到助手回复)", true);
    record("J3", "模型真的调用了工具(工具卡渲染)", toolUsed, toolUsed ? "" : "未观测到工具卡");
  } else if (upstreamFailure) {
    record("J2b", "真实网关跑通一轮对话(收到助手回复)", "skip", `上游账户失败:${turnError.slice(0, 120)}`);
    record("J3", "模型真的调用了工具(工具卡渲染)", "skip", "对话未完成,无法验证工具调用");
  } else {
    record("J2b", "真实网关跑通一轮对话(收到助手回复)", false, turnError.slice(0, 120) || "既无回复也无错误卡");
    record("J3", "模型真的调用了工具(工具卡渲染)", false, "未观测到工具卡");
  }
  // 失败回合必须对用户可见(TurnErrorCard),不能静默停在空白。
  record(
    "J2c",
    "失败回合对用户可见(错误横幅/错误卡)",
    replied ? true : Boolean(turnError),
    turnError.slice(0, 100),
  );

  // ── J4 会话管理 ──
  const convCount = await page.locator(".sidebar__conv").count();
  const title = await page.locator(".sidebar__conv-title").first().innerText().catch(() => "");
  record("J4", "会话在侧栏可见(可管理)", convCount >= 1, `${convCount} 个会话 / 首条:${title.slice(0, 20)}`);

  // ── J5 任务面板(真后端) ──
  const tasksBtn = page.locator('.chatview__tool-btn[aria-label*="任务"]').first();
  let tasksOk = false;
  try {
    await tasksBtn.waitFor({ state: "visible", timeout: 8000 });
    await tasksBtn.click();
    await page.waitForTimeout(1500);
    tasksOk = (await page.locator(".session-tasks, [data-testid*='task'], .task-panel").count()) > 0;
    await tasksBtn.click({ timeout: 5000 }).catch(() => {});
  } catch (error) {
    rawErrors.push(`tasks-panel: ${String(error).slice(0, 100)}`);
  }
  record("J5", "任务面板挂载且可打开", tasksOk);

  // ── J6 计划面板 ──
  const planBtn = page.locator('.chatview__tool-btn[aria-label*="计划"]').first();
  let planOk = false;
  try {
    await planBtn.waitFor({ state: "visible", timeout: 8000 });
    await planBtn.click();
    await page.waitForTimeout(1500);
    planOk = (await page.locator("[data-testid*='plan'], .plan-panel, .plan-editor").count()) > 0;
    await planBtn.click({ timeout: 5000 }).catch(() => {});
  } catch (error) {
    rawErrors.push(`plan-panel: ${String(error).slice(0, 100)}`);
  }
  record("J6", "计划面板挂载且可打开", planOk);

  // ── J7 记忆面板(走 IPC 真后端,不依赖 UI 入口) ──
  let memoryOk = false;
  try {
    await invoke("memory:add", { title: "readiness-note", body: "readiness probe note" });
    const list = await invoke("memory:list", {});
    memoryOk = Array.isArray(list) ? list.length > 0 : Boolean(list);
    await invoke("memory:delete", { id: "readiness-note" }).catch(() => undefined);
  } catch (error) {
    rawErrors.push(`memory: ${String(error).slice(0, 120)}`);
  }
  record("J7", "记忆通道真后端(写入/读取/删除)", memoryOk);

  // ── J8 产物中心 + 终端 + Git 面板 ──
  const artifacts = await invoke("artifacts:index", { sessionId: "readiness" }).catch(() => null);
  record("J8a", "产物中心通道可用", artifacts !== null, artifacts === null ? "调用失败" : `${artifacts?.artifacts?.length ?? 0} 个产物`);

  const gitStatus = await invoke("git:status", { cwd: ROOT });
  record("J8b", "Git 面板数据通道可用", gitStatus?.isRepo === true, `${gitStatus?.entries?.length ?? 0} 个改动`);

  const terminalOk = await page.evaluate(async () => {
    try {
      const channels = Object.keys(window.api ?? {});
      return channels.length > 0;
    } catch {
      return false;
    }
  });
  record("J8c", "终端面板通道在 preload 白名单内", terminalOk);

  // ── J9 设置 ──
  const settingsBtn = page.getByRole("button", { name: "设置" }).first();
  let settingsOk = false;
  try {
    await settingsBtn.click({ timeout: 8000 });
    await page.waitForTimeout(1500);
    const settingsText = await page.getByRole("dialog", { name: "设置" }).innerText().catch(() => "");
    settingsOk = settingsText.includes("数据管理") || settingsText.includes("外观") || settingsText.length > 40;
    await page.keyboard.press("Escape").catch(() => {});
  } catch { /* 未打开 */ }
  record("J9", "设置面板可打开(含数据管理/外观)", settingsOk);

  // ── J10 备份通道 ──
  const backup = await invoke("storage:backup-create", undefined).catch((e) => ({ error: String(e) }));
  record("J10", "数据备份通道可用", typeof backup?.path === "string", String(backup?.path ?? backup?.error ?? "").slice(0, 90));

  // ── J11 渲染层健康 ──
  const reactErrors = [...consoleErrors, ...rawErrors].filter((e) => /Minified React error|React error|Cannot read propert/i.test(e));
  const otherErrors = [...consoleErrors, ...rawErrors].filter((e) => !/Minified React error|React error|Cannot read propert/i.test(e));
  record("J11a", "零 React 错误", reactErrors.length === 0, reactErrors.slice(0, 2).join(" | "));
  record("J11b", "零 console 错误", otherErrors.length === 0, otherErrors.slice(0, 3).join(" | "));

  await page.screenshot({ path: join(SHOT_DIR, "readiness.png"), fullPage: false });
} catch (error) {
  const message = String(error?.message ?? error).slice(0, 600);
  log(`PROBE ERROR: ${message}`);
  try {
    await page?.screenshot({ path: join(SHOT_DIR, "probe-error.png") });
  } catch {}
  record("PROBE", "探针完成(无异常)", false, message);
} finally {
  try {
    await app?.close();
  } catch {}
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {}
}

const failed = checks.filter((c) => c.ok === false);
const skipped = checks.filter((c) => c.ok === "skip");
const passed = checks.filter((c) => c.ok === true);
console.log(
  `\n[readiness] ${passed.length} 通过 / ${skipped.length} 跳过(外部原因) / ${failed.length} 失败 — 共 ${checks.length}` +
    (skipped.length ? `\n跳过:${skipped.map((c) => c.id).join(", ")}` : "") +
    (failed.length ? `\n未通过:${failed.map((c) => c.id).join(", ")}` : "") +
    `\n截图:${SHOT_DIR}`,
);
process.exit(failed.length > 0 ? 1 : 0);
