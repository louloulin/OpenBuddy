import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-hf-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(2500);
const win = await app.browserWindow(page);
await win.evaluate((w) => { w.setContentSize(1728, 1031); });
await page.waitForTimeout(2500);

// dismiss onboarding
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(500);

// 1. 首页整体布局分析
const home = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const cs = (s, p) => { const el = document.querySelector(s); if (!el) return null; return getComputedStyle(el)[p]; };
  const allClasses = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 12).map(el => ({ cls: el.className.toString().slice(0, 50), y: Math.round(el.getBoundingClientRect().y), h: Math.round(el.getBoundingClientRect().height) }));
  return {
    sidebar: b(".sidebar"),
    main: b("main#main-content"),
    topbar: b(".main-topbar"),
    home: b(".home, [class*='home__root']"),
    homeInner: b(".home__inner"),
    homeHero: b(".home__hero"),
    homeTitle: b(".home__hero h1, .home__title, .home__hero-title"),
    homeSubtitle: b(".home__subtitle, .home__hero-sub"),
    sceneTabs: allClasses(".home__scene"),
    composerArea: b(".home__composer-area"),
    composer: b(".wb-composer, .home__composer"),
    composerTextarea: b(".wb-composer textarea, .home__composer textarea"),
    practices: b(".home__practices"),
    practiceCards: allClasses(".home__practice-card"),
    mainPadding: cs("main#main-content", "padding"),
    composerMargin: cs(".wb-composer", "marginTop"),
    heroPad: cs(".home__hero", "padding"),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    statusBar: b("[data-testid='status-bar']"),
  };
});
console.log("=== HOME ===");
console.log(JSON.stringify(home, null, 2));

// 2. 导航切换 — 点击「助理」
await page.click(".sidebar__nav-item:nth-child(2)");
await page.waitForTimeout(800);
const navAssistant = await page.evaluate(() => {
  const main = document.querySelector("main#main-content");
  return {
    mainInner: main ? Array.from(main.children).map(c => ({ tag: c.tagName, cls: c.className.toString().slice(0, 50) })) : [],
    activeNav: document.querySelector(".sidebar__nav-item--act")?.textContent.trim(),
    pageErrors: window.__PAGE_ERRORS__ || [],
  };
});
console.log("\n=== NAV → 助理 ===");
console.log(JSON.stringify(navAssistant, null, 2));

// 3. 导航切换 — 点击「项目」
await page.click(".sidebar__nav-item:nth-child(3)");
await page.waitForTimeout(800);
const navProject = await page.evaluate(() => ({
  activeNav: document.querySelector(".sidebar__nav-item--act")?.textContent.trim(),
  mainKids: Array.from(document.querySelector("main#main-content").children).map(c => c.tagName + "." + c.className.toString().slice(0, 30)),
  pageErrors: window.__PAGE_ERRORS__ || [],
}));
console.log("\n=== NAV → 项目 ===");
console.log(JSON.stringify(navProject, null, 2));

// 4. 导航切换 — 点击「专家·技能·连接器」
await page.click(".sidebar__nav-item:nth-child(4)");
await page.waitForTimeout(800);
const navExperts = await page.evaluate(() => ({
  activeNav: document.querySelector(".sidebar__nav-item--act")?.textContent.trim(),
  mainKids: Array.from(document.querySelector("main#main-content").children).map(c => c.tagName + "." + c.className.toString().slice(0, 30)),
  pageErrors: window.__PAGE_ERRORS__ || [],
}));
console.log("\n=== NAV → 专家·技能·连接器 ===");
console.log(JSON.stringify(navExperts, null, 2));

await app.close();
