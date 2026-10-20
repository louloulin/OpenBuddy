/**
 * ui-shots.mjs — 真实启动 UI 截图（UI 对照用）。
 *
 * 为什么要有它：这个仓库反复出现"文档说 UI 已对齐、实际不是"的情况（WORKBUDDY_UI_REFERENCE
 * 里 §6 与 R 章节自相矛盾）。所以 UI 改动之后不要靠描述验收 —— 起真 Electron 截图，
 * 逐张对照。2026-10-11 靠它发现并修掉了：任务面板盖住正文、模型选择器显示
 * "unknown/unknown"、空状态残留「自动化」入口、错误横幅双警告符、思考块完成后
 * 仍写「思考中」。
 *
 * 用法：
 *   node scripts/electron/ui-shots.mjs                     # 只截未配置状态（主页/空会话/任务面板）
 *   set -a; . /tmp/ob-e2e.env; set +a; node scripts/electron/ui-shots.mjs   # 真模型:额外配 provider 并截一轮真回答
 * 输出：/tmp/ob-ui/*.png
 *
 * 踩坑（都写进下面代码了）：首启 onboarding 向导会拦截指针事件，必须先关；
 * 用 IPC 建会话**不会**进 ChatView，要点侧栏会话行 `.sidebar__conv`;
 * Settings 里没有 provider 时按钮是「添加厂商」，有才是「编辑厂商」。
 */
import { _electron as electron } from "playwright";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const out = process.env.OB_UI_OUT || "/tmp/ob-ui";
mkdirSync(out, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), "ob-ui-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
const ws = join(userData, "ws");
mkdirSync(ws, { recursive: true });

const app = await electron.launch({
  args: [root],
  env: { ...process.env, ELECTRON_RENDERER_URL: "", PI_CODING_AGENT_DIR: piAgentDir },
});
const win = await app.firstWindow();
await win.waitForSelector("textarea", { timeout: 60_000 });
await win.waitForTimeout(1200);
await win.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 5000 }).catch(() => {});
await win.waitForTimeout(1200);
await win.screenshot({ path: join(out, "01-home.png") });

// 进入一个会话:先建会话(IPC),再点侧栏会话行
const session = await win.evaluate(([cwd]) => window.api.invoke("agent:new-session", { cwd }), [ws]);
await win.waitForTimeout(1500);
await win.locator(".sidebar__conv").first().click().catch(() => {});
await win.waitForTimeout(2500);
await win.screenshot({ path: join(out, "02-chat-empty.png") });

// 任务面板
const tasksBtn = win.locator('[data-tip^="任务"]').first();
if (await tasksBtn.count()) {
  await tasksBtn.click();
  await win.waitForTimeout(800);
  // 加两条任务,一条切到进行中
  const input = win.locator('input[aria-label="新增一个任务…"]').first();
  if (await input.count()) {
    await input.fill("整理本周项目周报");
    await win.locator(".session-tasks__add-btn").first().click();
    await win.waitForTimeout(400);
    await input.fill("回复客户合同问题");
    await win.locator(".session-tasks__add-btn").first().click();
    await win.waitForTimeout(600);
    await win.locator(".session-tasks__status").last().click();
    await win.waitForTimeout(600);
  }
  await win.screenshot({ path: join(out, "03-tasks-panel.png") });
}

// 真模型:照搬 smoke 里已验证的 Settings → 厂商/模型 配置路径
if (process.env.OPENBUDDY_E2E_API_KEY) {
  const modelId = process.env.OPENBUDDY_E2E_MODEL_ID;
  await win.getByRole("button", { name: "设置", exact: true }).first().click();
  const settings = win.locator(".settings-modal[role=dialog]");
  await settings.waitFor({ state: "visible", timeout: 8000 });
  // 首次没有 provider 时按钮是「添加厂商」;已有 provider 才是「编辑厂商」。
  const addProvider = settings.getByRole("button", { name: "添加厂商" });
  if (await addProvider.count()) await addProvider.click();
  else await settings.getByRole("button", { name: "编辑厂商" }).click();
  const providerEditor = win.locator(".models-settings-panel__editor-overlay[role=dialog]");
  await providerEditor.waitFor({ state: "visible", timeout: 8000 });
  await providerEditor.locator("select").first().selectOption("custom_anthropic");
  const providerInputs = providerEditor.locator("input");
  await providerInputs.nth(0).fill(process.env.OPENBUDDY_E2E_API_KEY);
  await providerInputs.nth(2).fill(process.env.OPENBUDDY_E2E_BASE_URL);
  await providerEditor.getByRole("button", { name: "保存" }).click();
  await providerEditor.waitFor({ state: "hidden", timeout: 8000 });
  const detail = win.locator(".models-settings-panel__provider-detail");
  await detail.getByRole("button", { name: "手动添加" }).click();
  const modelEditor = win.locator(".models-settings-panel__editor-overlay[role=dialog]");
  await modelEditor.waitFor({ state: "visible", timeout: 8000 });
  await modelEditor.locator("input").nth(0).fill(modelId);
  await modelEditor.getByRole("button", { name: "保存" }).click();
  await modelEditor.waitFor({ state: "hidden", timeout: 8000 });
  await win.getByRole("button", { name: "关闭设置" }).click();
  await win.locator(".model-selector__trigger").first().click();
  await win.getByRole("option").filter({ hasText: `custom_anthropic/${modelId}` }).click();
  await win.waitForTimeout(800);
  await win.screenshot({ path: join(out, "05-model-configured.png") });

  const box = win.locator("textarea").first();
  await box.fill("用一句话说明什么是向量数据库,并在第二行给一个 emoji。");
  await box.press("Enter");
  await win.waitForTimeout(35_000);
  await win.screenshot({ path: join(out, "06-chat-real-answer.png") });
}
console.log("session:", session?.sessionId);
console.log("shots:", out);
await app.close();
rmSync(userData, { recursive: true, force: true });
