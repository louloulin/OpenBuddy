import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-iss-"));
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

const r = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const list = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 30).map((el) => {
    const r = el.getBoundingClientRect();
    return { cls: el.className.toString().slice(0, 40), text: (el.textContent||"").trim().slice(0, 50), aria: el.getAttribute("aria-label") || "", x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  // user area analysis
  const userBtn = document.querySelector(".sidebar__user");
  const userName = document.querySelector(".sidebar__user-name");
  const userSub = document.querySelector(".sidebar__user-sub");
  const userNameRect = userName ? userName.getBoundingClientRect() : null;
  const userSubRect = userSub ? userSub.getBoundingClientRect() : null;
  // Detect overflow
  const nameOverflow = userName ? userName.scrollWidth > userName.clientWidth : false;
  const subOverflow = userSub ? userSub.scrollWidth > userSub.clientWidth : false;
  return {
    topbar: b(".main-topbar, .topbar, header[role='banner']"),
    topbarItems: list(".main-topbar button, .topbar button, header button"),
    statusBar: b(".status-bar, [class*='statusbar'], [class*='StatusBar']"),
    sidebar: b(".sidebar"),
    userBtn: b(".sidebar__user"),
    userAvatar: b(".sidebar__user-avatar"),
    userName: userNameRect ? { x: Math.round(userNameRect.x), y: Math.round(userNameRect.y), w: Math.round(userNameRect.width), h: Math.round(userNameRect.height), text: userName.textContent.trim(), scrollWidth: userName.scrollWidth, clientWidth: userName.clientWidth, overflow: nameOverflow } : null,
    userSub: userSubRect ? { x: Math.round(userSubRect.x), y: Math.round(userSubRect.y), w: Math.round(userSubRect.width), h: Math.round(userSubRect.height), text: userSub.textContent.trim(), scrollWidth: userSub.scrollWidth, clientWidth: userSub.clientWidth, overflow: subOverflow } : null,
    sbFooter: b(".sidebar__footer"),
    spacer: b(".sidebar__logo-spacer"),
    sidebarIconBtns: list(".sidebar__footer .sidebar__icon-btn"),
    composerArea: b(".home__composer-area, .wb-composer, [class*='composer']"),
    sidebarNavItems: list(".sidebar__nav-item, .sidebar__list-item, .sidebar a[href], .sidebar button[data-nav], .sidebar__menu button"),
    sidebarSessions: list(".sidebar__session, .session-item, [data-session-id]"),
    overflowEll: document.documentElement.style.overflow || getComputedStyle(document.documentElement).overflow,
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
