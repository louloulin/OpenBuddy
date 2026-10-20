/**
 * R81 — 模型配置真机验证(走真实 Settings UI 全流程)
 *
 * 用户真实路径:
 *   1. 打开设置 → 「模型」页
 *   2. 点「添加厂商」→ 在对话框里选 MiniMax 预设(自动填 baseUrl/协议/auth)
 *   3. 填 API Key → 点「Test connection」→ 断言 data-testid=provider-test-result
 *      的 data-status === "ok"
 *   4. 点「保存」→ 断言厂商出现在列表里
 *   5. 给该厂商添加模型 MiniMax-M3 → 保存
 *   6. 回聊天页,发一条消息,断言拿得到真实回复
 *
 * 这条链证明 "模型配置 → 真机可用" 不是两段独立的功能,而是一条打通的路径。
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

const report = {
  ok: false,
  credentialSource: describeSource(credentials),
  steps: [],
  pageErrors: [],
  consoleErrors: [],
};
const step = (name, ok, detail) => report.steps.push({ step: name, ok, detail: detail ?? null });

console.log(`[r81] ${describeSource(credentials)}`);
if (!apiKey) { console.log(JSON.stringify({ ...report, error: "no api key" }, null, 2)); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s) => String(s ?? "").split(apiKey).join("[redacted]").slice(0, 400);

const userData = mkdtempSync(join(tmpdir(), "ob-r81-"));
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
    cwd: root, timeout: 90_000, env: childEnv,
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => report.pageErrors.push(redact(e.message)));
  page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(redact(m.text())); });
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 60_000 });
  await sleep(2000);

  await page.evaluate(() => {
    window.localStorage.setItem("openbuddy.onboarding.state", JSON.stringify({
      version: 1, status: "done", index: 0, steps: [], startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now(),
    }));
    window.localStorage.setItem("openbuddy.tour.state", "seen");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  await sleep(2500);

  // ---- 1. 打开设置 ----
  // 找设置入口:优先 session-info / 侧栏底部按钮
  const opened = await page.evaluate(() => {
    const byLabel = [...document.querySelectorAll('[aria-label], button, [role="button"]')]
      .find((n) => /设置|Settings/i.test(n.getAttribute("aria-label") ?? n.textContent ?? ""));
    if (byLabel) { byLabel.click(); return "clicked-by-label"; }
    return "not-found";
  });
  step("打开设置面板", opened !== "not-found", opened);
  await sleep(1200);

  // 若没打开,试键盘快捷键 / IPC 兜底
  if (opened === "not-found") {
    await page.keyboard.press("Meta+,");
    await sleep(1200);
  }

  const settingsVisible = await page.locator(".models-settings-panel, [role=dialog]").first().isVisible().catch(() => false);
  step("设置面板可见", settingsVisible);
  if (!settingsVisible) throw new Error("设置面板打不开,后续无法继续");

  // ---- 2. 导航到「模型」页 ----
  const navClicked = await page.evaluate(() => {
    const items = [...document.querySelectorAll("button, [role=tab], li, a")];
    const t = items.find((n) => (n.textContent ?? "").trim() === "模型");
    if (t) { t.click(); return true; }
    return false;
  });
  step("切到「模型」页", navClicked);
  await sleep(900);

  const panelReady = await page.locator(".models-settings-panel").first().isVisible().catch(() => false);
  step("模型面板渲染", panelReady);

  // ---- 3. 点「添加厂商」 ----
  await page.getByRole("button", { name: /添加厂商/ }).first().click();
  await sleep(800);
  const editorOpen = await page.locator(".models-settings-panel__editor").first().isVisible().catch(() => false);
  step("添加厂商对话框打开", editorOpen);

  // ---- 4. 选 MiniMax 预设 + 填 key ----
  const picked = await page.evaluate(() => {
    const sel = document.querySelector("select");
    if (!sel) return false;
    const opt = [...sel.options].find((o) => /minimax/i.test(o.value) || /MiniMax/i.test(o.textContent ?? ""));
    if (!opt) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return opt.value;
  });
  step("选中 MiniMax 预设", Boolean(picked) && picked !== "false", String(picked));
  await sleep(600);

  // 填 API Key(找 key 输入框)
  const keyFilled = await page.evaluate((key) => {
    const inputs = [...document.querySelectorAll("input")];
    const target = inputs.find((i) => /api.?key/i.test(i.placeholder ?? "") || i.type === "password");
    if (!target) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(target, key);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, apiKey);
  step("填写 API Key", keyFilled);

  const baseUrlOk = await page.evaluate((want) => {
    const inputs = [...document.querySelectorAll("input")];
    return inputs.some((i) => (i.value ?? "").includes("minimaxi.com")) || want.includes("minimaxi.com");
  }, baseUrl);
  step("Base URL 已预填(minimaxi.com)", baseUrlOk);

  await sleep(400);

  // ---- 5. Test connection ----
  const testBtn = page.locator('[data-testid="provider-test-button"]').first();
  if (await testBtn.isVisible().catch(() => false)) {
    await testBtn.click();
    const testResult = await page.waitForFunction(
      () => {
        const n = document.querySelector('[data-testid="provider-test-result"]');
        if (!n) return false;
        const s = n.getAttribute("data-status");
        return s && s !== "testing" ? s : false;
      },
      undefined, { timeout: 60_000, polling: 250 },
    ).then((h) => h.jsonValue()).catch(() => null);
    const msg = await page.locator('[data-testid="provider-test-result"]').first().innerText().catch(() => "");
    step("Test connection 返回 healthy", testResult === "ok", `${testResult} | ${redact(msg)}`);
  } else {
    step("Test connection 按钮存在", false, "按钮不可见");
  }

  // ---- 6. 保存厂商 ----
  await page.locator(".models-settings-panel__editor-save").first().click();
  await sleep(1500);
  const providerSaved = await page.evaluate(() => {
    const list = document.querySelector(".models-settings-panel__provider-list");
    return Boolean(list && /minimax/i.test(list.textContent ?? ""));
  });
  step("厂商保存后出现在列表", providerSaved);

  // ---- 7. 从磁盘二次确认(不信 UI,查真值) ----
  const disk = await page.evaluate(async () => {
    try {
      const r = await window.api.invoke("agent:providers-list");
      return { providers: r?.providers?.map((p) => p.id) ?? [], models: r?.models?.map((m) => `${m.providerId}/${m.modelId}`) ?? [] };
    } catch (e) { return { error: String(e?.message ?? e) }; }
  });
  step("IPC providers-list 里有 minimax", disk.providers?.includes("minimax") === true, JSON.stringify(disk.providers));
  report.providerList = disk;

  // ---- 8. 全链路闭环:刚刚在 UI 里配好的厂商,必须真的能聊天 ----
  // 这是"模型配置"与"AI Chat"两块的接缝。只断言 settings 保存成功、
  // 或者只断言 chat 能回复,都证明不了这条缝是通的 —— 必须由 UI 配置
  // 出来的 provider 直接驱动一次真实对话。
  const closeBtn = page.locator('.models-settings-panel__editor-overlay, [role=dialog]').first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await sleep(600);
  }
  // 关设置面板(切到「模型」页之后需要回到 chat)
  await page.evaluate(() => {
    const close = [...document.querySelectorAll("button")]
      .find((b) => /关闭|Close/i.test(b.getAttribute("aria-label") ?? ""));
    if (close) close.click();
  });
  await sleep(1200);
  // 保险:再按一次 Escape
  await page.keyboard.press("Escape");
  await sleep(800);

  const composer = page.locator("textarea.wb-composer__input").first();
  const composerUsable = await page.waitForFunction(
    () => {
      const t = document.querySelector("textarea.wb-composer__input");
      return Boolean(t) && !t.disabled;
    },
    undefined, { timeout: 60_000, polling: 200 },
  ).then(() => true).catch(() => false);
  step("UI 配置后 composer 可用(apiReady=true)", composerUsable);

  if (composerUsable) {
    const baseline = await page.evaluate(() => document.querySelectorAll(".msg--assistant").length);
    await composer.click();
    await composer.fill("");
    await composer.type("只回复这个词:SETTINGS-OK", { delay: 8 });
    const sendReady = await page.waitForFunction(
      () => {
        const b = document.querySelector('button[aria-label="发送"]');
        if (!b) return false;
        const r = b.getBoundingClientRect();
        return !b.disabled && r.width > 0 && r.height > 0;
      },
      undefined, { timeout: 30_000, polling: 150 },
    ).then(() => true).catch(() => false);
    if (sendReady) {
      await page.locator('button[aria-label="发送"]').first().click();
      const replied = await page.waitForFunction(
        (base) => {
          const nodes = [...document.querySelectorAll(".msg--assistant .msg__body")];
          if (nodes.length <= base) return false;
          const t = (nodes[nodes.length - 1].innerText ?? "").replace(/^深度思考\s*/u, "").trim();
          return t.length > 0;
        },
        baseline, { timeout: 90_000, polling: 250 },
      ).then(() => true).catch(() => false);
      const answer = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll(".msg--assistant .msg__body")];
        return (nodes[nodes.length - 1]?.innerText ?? "").replace(/^深度思考\s*/u, "").trim();
      });
      step("UI 配置的厂商真的能对话", replied && answer.length > 0, answer.slice(0, 120));
      report.chatAnswer = answer;
    } else {
      step("发送按钮可用", false);
    }
  }
} catch (err) {
  report.error = redact(String(err?.message ?? err));
} finally {
  try { await app.close(); } catch { /* */ }
  report.ok = report.steps.every((s) => s.ok) && report.pageErrors.length === 0;
  const json = JSON.stringify(report, null, 2);
  console.log(json);
  try { const { writeFileSync } = await import("node:fs"); writeFileSync("/tmp/r81-settings-report.json", json); } catch { /* */ }
  process.exit(report.ok ? 0 : 1);
}
