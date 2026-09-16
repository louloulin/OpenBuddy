import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r15-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });

await page.addInitScript(() => {
  window.__PAGE_ERRORS__ = [];
  window.addEventListener("error", (e) => window.__PAGE_ERRORS__.push({ msg: String(e.error?.message ?? e.message), stack: String(e.error?.stack ?? "").slice(0, 400) }));
  window.addEventListener("unhandledrejection", (e) => window.__PAGE_ERRORS__.push({ msg: "UnhandledRejection: " + String(e.reason?.message ?? e.reason) }));
});

await page.waitForTimeout(14_000);

// Close onboarding wizard first
try { await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {}); } catch {}
await page.waitForTimeout(1500);

const homeState = await page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    topbar: r(".main-topbar"),
    searchBtn: r(".main-topbar__search"),
    sidebarFooter: r(".sidebar__footer"),
    statusIndicator: r(".status-indicator"),
    userBtn: r(".sidebar__user"),
    bellBtn: r(".sidebar__icon-btn[aria-label='通知']"),
    setBtn: r(".sidebar__icon-btn[aria-label='设置']"),
    scrollbarSession: (() => {
      const el = document.querySelector(".sidebar__content");
      if (!el) return null;
      return { scrollH: el.scrollHeight, clientH: el.clientHeight, children: el.children.length };
    })(),
  };
});
console.log("=== HOME PAGE ===");
console.log(JSON.stringify(homeState, null, 2));

// Click "新建任务" to start a new session
try {
  await page.click("[aria-label='新建任务']");
  await page.waitForTimeout(3000);
} catch (e) { console.log('new task failed', String(e).slice(0, 100)); }

const sessionState = await page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    topbar: r(".main-topbar"),
    searchBtn: r(".main-topbar__search"),
    topbarActions: r(".main-topbar__action-menu, .main-topbar [data-tip='更多操作'], [aria-label='更多操作']"),
    title: document.querySelector(".main-topbar__title")?.textContent?.trim(),
    composer: r(".composer-shell, [data-composer], .composer"),
    artifactTabs: r(".artifact-tabs-bar, [class*='ArtifactTabs']"),
    statusBar: r(".status-bar, .app__statusbar, footer[role='status']"),
  };
});
console.log("=== SESSION PAGE ===");
console.log(JSON.stringify(sessionState, null, 2));

// Click the search button to verify it works on session page
try {
  await page.click(".main-topbar__search");
  await page.waitForTimeout(2000);
  const searchOpened = await page.evaluate(() => !!document.querySelector(".conversation-search-modal"));
  console.log("SEARCH MODAL OPENED:", searchOpened);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
} catch (e) { console.log('search click on session failed', String(e).slice(0, 100)); }

// Open settings to verify
try {
  await page.click("[aria-label='设置']");
  await page.waitForTimeout(2500);
  const settingsOpen = await page.evaluate(() => !!document.querySelector(".settings-modal"));
  console.log("SETTINGS OPENED:", settingsOpen);
} catch (e) { console.log('settings failed', String(e).slice(0, 100)); }

const finalErrors = await page.evaluate(() => window.__PAGE_ERRORS__ || []);
console.log("=== FINAL ERRORS ===");
console.log(JSON.stringify(finalErrors, null, 2));

await app.close();
process.exit(0);
