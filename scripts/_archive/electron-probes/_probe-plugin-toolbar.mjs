/**
 * _probe-plugin-toolbar.mjs — 验证 `composer.toolbar.action` 插件按钮真的出现在 Composer 工具栏。
 *
 * 流程：新建会话 → 进入 Composer → 派发 plugin-sdk 的 register-slot 事件 →
 * 断言工具栏多出按钮 → 点击 → 断言文本被插入 → unregister → 按钮消失。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-toolbar-"));
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

// 首页 composer 就在场景区下方
await page.waitForSelector(".wb-composer", { timeout: 20_000 });

const before = await page.evaluate(() => ({
  toolbarButtons: document.querySelectorAll(".wb-composer__plugin-action").length,
  labels: [...document.querySelectorAll(".wb-composer__plugin-action")].map((e) => e.textContent.trim()),
}));

await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("openbuddy:register-slot", {
    detail: {
      name: "composer.toolbar.action", kind: "list", scope: "session",
      payload: { id: "insert-timestamp", label: "插入时间戳", icon: "🕐", insertText: "[2026-09-15T00:00:00Z]" },
    },
  }));
});
await page.waitForTimeout(400);

const after = await page.evaluate(() => ({
  toolbarButtons: document.querySelectorAll(".wb-composer__plugin-action").length,
  labels: [...document.querySelectorAll(".wb-composer__plugin-action")].map((e) => e.textContent.trim()),
}));

// 点击插件按钮 → 文本应被插入输入框
const btn = page.locator(".wb-composer__plugin-action", { hasText: "插入时间戳" }).first();
let inserted = null;
if (await btn.count()) {
  await btn.click();
  await page.waitForTimeout(300);
  inserted = await page.evaluate(() => {
    const ta = document.querySelector(".wb-composer textarea, .wb-composer [contenteditable='true']");
    return ta ? (ta.value ?? ta.textContent ?? "") : null;
  });
}

await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("openbuddy:unregister-slot", { detail: { name: "composer.toolbar.action" } }));
});
await page.waitForTimeout(400);
const afterUnregister = await page.evaluate(() => ({
  toolbarButtons: document.querySelectorAll(".wb-composer__plugin-action").length,
}));

console.log("=== before ===", JSON.stringify(before));
console.log("=== after register ===", JSON.stringify(after, null, 2));
console.log("=== inserted text ===", JSON.stringify(inserted));
console.log("=== after unregister ===", JSON.stringify(afterUnregister));
console.log("=== errors ===", errors.length ? errors.join("\n") : "(none)");

const ok =
  after.toolbarButtons === before.toolbarButtons + 1 &&
  after.labels.some((l) => l.includes("插入时间戳")) &&
  typeof inserted === "string" && inserted.includes("[2026-09-15T00:00:00Z]") &&
  afterUnregister.toolbarButtons === before.toolbarButtons &&
  errors.length === 0;
console.log(ok ? "\nRESULT: PASS" : "\nRESULT: FAIL");
await app.close();
process.exit(ok ? 0 : 1);
