/**
 * _ui-shot-tmp.mjs — 真实启动截图(用完即删)。
 * 用途:给「UI 对齐 WorkBuddy」提供当前真实界面作为基线,而不是靠猜。
 */
import { _electron as electron } from "playwright";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const out = "/tmp/ob-ui";
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
