/**
 * _modal-tmp.mjs — 复现"真模型工具调用后弹窗卡住"并识别弹窗来源(用完即删)。
 */
import { _electron as electron } from "playwright";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-modal-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
const ws = join(userData, "ws");
mkdirSync(ws, { recursive: true });

const app = await electron.launch({ args: [root], env: { ...process.env, ELECTRON_RENDERER_URL: "", PI_CODING_AGENT_DIR: piAgentDir } });
const win = await app.firstWindow();
await win.waitForSelector("textarea", { timeout: 60_000 });
await win.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 5000 }).catch(() => {});

// 与冒烟一致的自动应答:收到权限/提问事件就通过 IPC 判定
await win.evaluate(() => {
  window.__uiRequests = [];
  window.api.events.on("pi://permission", (payload) => {
    window.__uiRequests.push({ kind: "permission", payload: JSON.stringify(payload).slice(0, 200) });
    void window.api.invoke("agent:resolve-permission", { requestId: payload.requestId, optionId: "allow", cancelled: false });
  });
  window.api.events.on("pi://question", (payload) => {
    window.__uiRequests.push({ kind: "question", payload: JSON.stringify(payload).slice(0, 200) });
    const q = payload.questions?.[0];
    void window.api.invoke("agent:resolve-question", {
      requestId: payload.requestId,
      ...(q?.options?.length ? { answers: { [q.question]: q.options[0] } } : { annotations: { [q?.question ?? "q"]: { notes: "probe" } } }),
      cancelled: false,
    });
  });
});

// 配 provider(照搬 ui-shots)
await win.getByRole("button", { name: "设置", exact: true }).first().click();
const settings = win.locator(".settings-modal[role=dialog]");
await settings.waitFor({ state: "visible", timeout: 8000 });
const add = settings.getByRole("button", { name: "添加厂商" });
if (await add.count()) await add.click(); else await settings.getByRole("button", { name: "编辑厂商" }).click();
const pe = win.locator(".models-settings-panel__editor-overlay[role=dialog]");
await pe.waitFor({ state: "visible", timeout: 8000 });
await pe.locator("select").first().selectOption("custom_anthropic");
const pin = pe.locator("input");
await pin.nth(0).fill(process.env.OPENBUDDY_E2E_API_KEY);
await pin.nth(2).fill(process.env.OPENBUDDY_E2E_BASE_URL);
await pe.getByRole("button", { name: "保存" }).click();
await pe.waitFor({ state: "hidden", timeout: 8000 });
const detail = win.locator(".models-settings-panel__provider-detail");
await detail.getByRole("button", { name: "手动添加" }).click();
const me = win.locator(".models-settings-panel__editor-overlay[role=dialog]");
await me.waitFor({ state: "visible", timeout: 8000 });
await me.locator("input").nth(0).fill(process.env.OPENBUDDY_E2E_MODEL_ID);
await me.getByRole("button", { name: "保存" }).click();
await me.waitFor({ state: "hidden", timeout: 8000 });
await win.getByRole("button", { name: "关闭设置" }).click();
await win.locator(".model-selector__trigger").first().click();
await win.getByRole("option").filter({ hasText: `custom_anthropic/${process.env.OPENBUDDY_E2E_MODEL_ID}` }).click();
await win.waitForTimeout(600);

const session = await win.evaluate(([cwd]) => window.api.invoke("agent:new-session", { cwd }), [ws]);
const composer = win.locator("textarea").first();
await composer.fill("执行一次 pwd 命令,然后把输出原样贴出来。必须真的调用工具。");
await composer.press("Enter");
await win.waitForTimeout(25_000);

console.log("ui requests:", JSON.stringify(await win.evaluate(() => window.__uiRequests)));
console.log("modal:", JSON.stringify(await win.evaluate(() => {
  const el = document.querySelector(".request-modal-overlay");
  return el ? { present: true, kind: el.querySelector(".request-modal")?.className, text: (el.textContent || "").slice(0, 160) } : { present: false };
})));
console.log("stores:", JSON.stringify(await win.evaluate(() => ({
  permission: typeof window.__obPermissionStore,
}))));
await app.close();
rmSync(userData, { recursive: true, force: true });
