// 捕获 3 个核心 UI 态：欢迎空态 / 已填充对话 / 流式生成中。
import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots/states";
mkdirSync(outDir, { recursive: true });
const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "out/main/index.js")],
  cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);

// State A: 当前对话 (已填充)
await page.screenshot({ path: join(outDir, "state-A-populated.png") });
const populated = await page.evaluate(() => {
  return {
    title: document.title,
    msgCount: document.querySelectorAll(".msg").length,
    visibleClassNames: Array.from(new Set(Array.from(document.querySelectorAll("[class]")).map(e => e.className).filter(c => typeof c === "string" && c && c.length < 50).slice(0, 50))),
  };
});
console.log("STATE A (populated):", JSON.stringify(populated, null, 2));

// State B: 切到欢迎/空态：尝试点击 "+" 或新对话按钮
// 找侧栏顶部所有可点击元素
const sidebarTopBtns = await page.$$eval(".sidebar__header button, .sidebar__header [role=button], .sidebar__header a, .sidebar__header svg", els => els.map(el => ({
  tag: el.tagName, cls: (el.className?.baseVal || el.className || "").toString().slice(0,40),
  title: el.getAttribute("title") || "",
  aria: el.getAttribute("aria-label") || "",
})));
console.log("sidebar header interactive:", JSON.stringify(sidebarTopBtns, null, 2));

// 也找找有没有 home / welcome 路由
const homeR = await page.$$eval("[class*='home__scene'], [class*='home__'], [class*='scene']", els => els.length);
console.log("home scene elements:", homeR);

// 直接渲染欢迎路径：删所有 conversations，触发空态
// 找 dev console hook
const hasStoreHook = await page.evaluate(() => !!window.__OPENBUDDY__ || !!window.__store || !!window.useSessionStore);
console.log("has store hook:", hasStoreHook);

// State C: 截顶栏 + chatview 详细图
const topbar = page.locator(".app__topbar, [class*='topbar']").first();
try { await topbar.screenshot({ path: join(outDir, "zoom-topbar.png") }); } catch {}
const chatView = page.locator(".chatview, [class*='chatview']").first();
try { await chatView.screenshot({ path: join(outDir, "zoom-chatview.png") }); } catch {}
const composer = page.locator(".composer, [class*='composer']").first();
try { await composer.screenshot({ path: join(outDir, "zoom-composer.png") }); } catch {}

await app.close();
