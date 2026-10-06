import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-areas-"));
mkdirSync("/tmp/ob-shots3", { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, projectRoot],
  executablePath: join(projectRoot, "node_modules", ".bin", "electron"),
  cwd: projectRoot, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(2500);

const win = await app.browserWindow(page);
await win.evaluate((w) => { w.setContentSize(1728, 1031); });
await page.waitForTimeout(2500);

await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(800);

await page.screenshot({ path: "/tmp/ob-shots3/home.png" });

// === Check Home Page ===
const homeInfo = await page.evaluate(() => {
  const home = document.querySelector(".home-page, .wb-home-page, [data-page='home']");
  const h1 = document.querySelector("h1, h2");
  const tasks = Array.from(document.querySelectorAll(".home-page__task, .wb-home-task, [data-task-card]")).length;
  const cards = Array.from(document.querySelectorAll(".home-page__card, .wb-home-card, [data-feature-card]")).length;
  const allButtons = Array.from(document.querySelectorAll("button")).slice(0, 30).map(b => ({
    text: b.textContent?.trim().slice(0, 30),
    aria: b.getAttribute("aria-label"),
    visible: b.getBoundingClientRect().width > 0,
  })).filter(b => b.text || b.aria);
  return {
    homeExists: !!home,
    h1Text: h1?.textContent?.trim().slice(0, 50),
    taskCount: tasks,
    cardCount: cards,
    visibleButtons: allButtons.slice(0, 15),
  };
});
console.log("Home:", JSON.stringify(homeInfo, null, 2));

// === Check Topbar ===
const topbarInfo = await page.evaluate(() => {
  const tb = document.querySelector(".main-topbar");
  if (!tb) return null;
  const r = tb.getBoundingClientRect();
  const buttons = Array.from(tb.querySelectorAll("button")).map(b => ({
    aria: b.getAttribute("aria-label"),
    text: b.textContent?.trim().slice(0, 30),
    title: b.title,
    visible: b.getBoundingClientRect().width > 0,
    hasDataTip: b.hasAttribute("data-tip"),
  })).filter(b => b.visible && (b.aria || b.text));
  return { rect: { w: Math.round(r.width), h: Math.round(r.height) }, buttons };
});
console.log("\nTopbar:", JSON.stringify(topbarInfo, null, 2));

// === Check Composer ===
const composerInfo = await page.evaluate(() => {
  const c = document.querySelector(".composer, .wb-composer, [data-composer], .conversation-composer, .composer-shell");
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const textarea = c.querySelector("textarea, [contenteditable]");
  const buttons = Array.from(c.querySelectorAll("button")).map(b => ({
    aria: b.getAttribute("aria-label"),
    text: b.textContent?.trim().slice(0, 30),
  })).filter(b => b.aria || b.text);
  return {
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    hasInput: !!textarea,
    inputPlaceholder: textarea?.getAttribute("placeholder"),
    buttons,
  };
});
console.log("\nComposer:", JSON.stringify(composerInfo, null, 2));

// === Check Sidebar Top Items ===
const sidebarNavInfo = await page.evaluate(() => {
  const nav = document.querySelector(".sidebar__nav, .sidebar nav, .wb-sidebar-nav");
  if (!nav) return null;
  const items = Array.from(nav.querySelectorAll("button, a")).slice(0, 15).map(b => ({
    text: b.textContent?.trim().slice(0, 20),
    aria: b.getAttribute("aria-label"),
    cls: b.className?.toString().slice(0, 40),
  })).filter(b => b.text || b.aria);
  return { count: items.length, items };
});
console.log("\nSidebar nav:", JSON.stringify(sidebarNavInfo, null, 2));

await app.close();
