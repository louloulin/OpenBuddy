/**
 * _probe-microkernel-io.mjs — 微内核交互验证。
 *
 * 前三件事：
 *   1. 内核 entries 计数正确（shell.overlay = 5，single 不重复）
 *   2. 通过 slot 渲染出来的 overlay 真的能打开（⌘K 搜索 / 设置面板）
 *   3. 侧栏底部按钮没有被裁切（历史回归点）
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-mk-io-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !/api\/events\.(mux|host)/.test(m.text())) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Array.isArray(window.__ob_builtin_report), undefined, { timeout: 20_000 });
await page.waitForSelector(".sidebar__nav-item", { timeout: 20_000 });

// --- 1. 内核 entries 计数 ---
const counts = await page.evaluate(() => {
  const core = window.__ob_slotcore;
  if (!core) return null;
  const rows = core.snapshot();
  const pick = (n) => rows.find((r) => r.name === n) ?? null;
  return {
    size: core.size(),
    sidebar: pick("sidebar"),
    conversation: pick("conversation"),
    home: pick("home"),
    overlaySearch: pick("overlay.search"),
    overlaySettings: pick("overlay.settings"),
    notifications: pick("notifications"),
    shellOverlay: pick("shell.overlay"),
  };
});

const layout = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  return {
    appDisplay: getComputedStyle(q(".app")).display,
    appHeight: Math.round(q(".app").getBoundingClientRect().height),
    viewport: window.innerHeight,
    sidebarFooterBottom: q(".sidebar__footer") ? Math.round(q(".sidebar__footer").getBoundingClientRect().bottom) : null,
    mainScrollHeight: Math.round(q("main")?.scrollHeight ?? 0),
  };
});

// --- 2. ⌘K 打开搜索（SearchSurface 由 overlay.search slot 提供）---
await page.keyboard.press("Meta+k");
await page.waitForTimeout(600);
const searchOpen = await page.evaluate(() => {
  const el = document.querySelector(".conversation-search-modal, [data-search-overlay], .search-overlay");
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  return { found: true, w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
});
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// --- 3. 设置面板（overlay.settings slot）---
await page.keyboard.press("Meta+,");
await page.waitForTimeout(800);
const settingsOpen = await page.evaluate(() => {
  const el = document.querySelector(".settings-modal");
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  return { found: true, w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
});
await page.keyboard.press("Escape");

console.log("=== 内核 entries ===");
console.log(JSON.stringify(counts, null, 2));
console.log("=== 布局 ===");
console.log(JSON.stringify(layout, null, 2));
console.log("=== ⌘K 搜索 ===");
console.log(JSON.stringify(searchOpen));
console.log("=== ⌘, 设置 ===");
console.log(JSON.stringify(settingsOpen));
console.log("=== errors ===");
console.log(errors.length ? errors.join("\n") : "(none)");
await app.close();
