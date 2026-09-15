/**
 * _probe-plugin-sdk.mjs — 验证 `@openbuddy/plugin-sdk` 事件真的接进了微内核。
 *
 * 场景：第三方插件调用 `defineExtension().setup(api)` → `api.registerSlot(...)`。
 * 在 Phase K.3 之前，那只派发一个没有人监听的 DOM 事件，插件等于没注册。
 * 现在 `installPluginSdkBridge()` 会把它接进内核，HomePage 的场景 tab 行
 * 会多出一个来自插件的 tab。
 *
 * 本探针在渲染进程里直接派发同样的 DOM 事件（等价于插件 setup 的效果），
 * 断言 (1) 内核多出对应 entry (2) DOM 里真的渲染出插件 tab。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-pluginsdk-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Array.isArray(window.__ob_builtin_report), undefined, { timeout: 20_000 });
await page.waitForSelector(".home__scenes .home__scene", { timeout: 20_000 });

const before = await page.evaluate(() => ({
  sceneTabs: document.querySelectorAll(".home__scenes .home__scene").length,
  pluginTabs: document.querySelectorAll(".home__scenes .home__scene--plugin").length,
  sceneSlotEntries: (window.__ob_slotcore?.snapshot() ?? []).find((r) => r.name === "home.scene.tab")?.entries ?? 0,
}));

// 模拟第三方插件 setup()：派发 SDK 的 4 类事件
await page.evaluate(() => {
  const fire = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }));
  fire("openbuddy:register-slot", {
    name: "home.scene.tab", kind: "list", scope: "root",
    payload: { id: "meeting-minutes", label: "会议纪要", icon: "📝", description: "把会议录音整理成纪要" },
  });
  fire("openbuddy:register-command", { id: "greet", label: "/greet", onExecute: () => {} });
});
await page.waitForTimeout(400);

const after = await page.evaluate(() => {
  const core = window.__ob_slotcore;
  const rows = core ? core.snapshot() : [];
  const scene = rows.find((r) => r.name === "home.scene.tab");
  const cmd = rows.find((r) => r.name === "plugin.command");
  return {
    sceneTabs: document.querySelectorAll(".home__scenes .home__scene").length,
    pluginTabs: document.querySelectorAll(".home__scenes .home__scene--plugin").length,
    pluginTabLabels: [...document.querySelectorAll(".home__scenes .home__scene--plugin")].map((el) => el.textContent.trim()),
    sceneSlotEntries: scene?.entries ?? 0,
    scenePayloadIds: scene?.payloadIds ?? [],
    commandEntries: cmd?.entries ?? 0,
  };
});

// 反注册 → 插件 tab 应消失（disposer 归还）
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("openbuddy:unregister-slot", { detail: { name: "home.scene.tab" } }));
});
await page.waitForTimeout(400);
const afterUnregister = await page.evaluate(() => ({
  pluginTabs: document.querySelectorAll(".home__scenes .home__scene--plugin").length,
  sceneSlotEntries: (window.__ob_slotcore?.snapshot() ?? []).find((r) => r.name === "home.scene.tab")?.entries ?? 0,
}));

console.log("=== before ===");
console.log(JSON.stringify(before, null, 2));
console.log("=== after register ===");
console.log(JSON.stringify(after, null, 2));
console.log("=== after unregister ===");
console.log(JSON.stringify(afterUnregister, null, 2));
console.log("=== errors ===");
console.log(errors.length ? errors.join("\n") : "(none)");

const ok =
  after.sceneSlotEntries === before.sceneSlotEntries + 1 &&
  after.pluginTabs === 1 &&
  after.pluginTabLabels.some((l) => l.includes("会议纪要")) &&
  after.commandEntries === 1 &&
  afterUnregister.pluginTabs === 0 &&
  afterUnregister.sceneSlotEntries === before.sceneSlotEntries &&
  errors.length === 0;
console.log(ok ? "\nRESULT: PASS" : "\nRESULT: FAIL");
await app.close();
process.exit(ok ? 0 : 1);
