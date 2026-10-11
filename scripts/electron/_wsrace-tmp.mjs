/**
 * _wsrace-tmp.mjs — 复现并定位 workspace 重命名竞态(用完即删)。
 * 现象:冒烟里 prompt 过一轮真模型之后,workspace:create 得到的 id 在 rename 时报
 * workspace-not-found。隔离的 create→rename 却正常。
 */
import { _electron as electron } from "playwright";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-wsrace-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
const ws = join(userData, "ws");
mkdirSync(ws, { recursive: true });

const app = await electron.launch({
  args: [root],
  env: { ...process.env, ELECTRON_RENDERER_URL: "", PI_CODING_AGENT_DIR: piAgentDir, ELECTRON_ENABLE_LOGGING: "1" },
});
const win = await app.firstWindow();
await win.waitForSelector("textarea", { timeout: 60_000 });
const invoke = (c, p) => win.evaluate(([ch, pl]) => window.api.invoke(ch, pl), [c, p]);

// 真 provider 配置(照搬 ui-shots 的路径)
if (process.env.OPENBUDDY_E2E_API_KEY) {
  await win.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 5000 }).catch(() => {});
  await win.getByRole("button", { name: "设置", exact: true }).first().click();
  const settings = win.locator(".settings-modal[role=dialog]");
  await settings.waitFor({ state: "visible", timeout: 8000 });
  const add = settings.getByRole("button", { name: "添加厂商" });
  if (await add.count()) await add.click();
  else await settings.getByRole("button", { name: "编辑厂商" }).click();
  const pe = win.locator(".models-settings-panel__editor-overlay[role=dialog]");
  await pe.waitFor({ state: "visible", timeout: 8000 });
  await pe.locator("select").first().selectOption("custom_anthropic");
  const pin = pe.locator("input");
  await pin.nth(0).fill(process.env.OPENBUDDY_E2E_API_KEY);
  await pin.nth(2).fill(process.env.OPENBUDDY_E2E_BASE_URL);
  await pe.getByRole("button", { name: "保存" }).click();
  await pe.waitFor({ state: "hidden", timeout: 8000 });
  // 手动添加模型 + 选中(少了这步 prompt 会报 "No API key found for the selected model")
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
}

const session = await invoke("agent:new-session", { cwd: ws });
console.log("session:", session?.sessionId);
await invoke("agent:prompt", { sessionId: session?.sessionId, text: "只回复 OK,不要调用工具。" });
await win.waitForTimeout(6000);

const created = await invoke("workspace:create", { path: ws, title: "Race WS" });
const id = created?.workspace?.workspaceId;
console.log("created:", JSON.stringify(created?.workspace));
const listRightAfter = await invoke("workspace:list");
console.log("list right after create:", JSON.stringify(listRightAfter?.items?.map((e) => e.workspaceId)));
try {
  const renamed = await invoke("workspace:rename", { workspaceId: id, title: "Race WS 2" });
  console.log("rename OK:", JSON.stringify(renamed?.workspace?.title));
} catch (e) {
  console.log("rename FAILED:", String(e).slice(0, 160));
}
const listAfter = await invoke("workspace:list");
console.log("list after:", JSON.stringify(listAfter?.items?.map((e) => e.workspaceId)));
await app.close();
rmSync(userData, { recursive: true, force: true });
