import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cmp-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
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
await win.evaluate((w) => { w.setContentSize(1728, 1091); });
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/ob-current.png", fullPage: false });

// Sample colors at key reference points
const m = await page.evaluate(() => {
  const el = (s) => document.querySelector(s);
  const cs = (s, p) => { const e = el(s); return e ? getComputedStyle(e)[p] : null; };
  const rect = (s) => { const e = el(s); if (!e) return null; const r = e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const sidebar = rect('.sidebar');
  const sidebarBg = cs('.sidebar', 'backgroundColor');
  const sidebarBorder = cs('.sidebar', 'borderRightColor');
  const sidebarWidth = cs('.sidebar', 'width');
  const appBody = rect('.app__body');
  const sidebarFooter = rect('.sidebar__footer, .sidebar-footer');
  const sidebarUser = rect('.sidebar__user');
  const sidebarUserAvatar = rect('.sidebar__user-avatar');
  const sidebarUserName = rect('.sidebar__user-name, .sidebar__user-text');
  
  return {
    sidebar: { rect: sidebar, bg: sidebarBg, border: sidebarBorder, width: sidebarWidth },
    appBody: appBody,
    sidebarFooter,
    sidebarUser,
    sidebarUserAvatar,
    sidebarUserName,
    // Check if sidebar has user/settings area at bottom
    allSidebarElements: Array.from(document.querySelectorAll('.sidebar *')).filter(e => {
      const r = e.getBoundingClientRect();
      return r.height > 0 && r.width > 0 && r.bottom > 900;  // Bottom of sidebar
    }).slice(0, 10).map(e => {
      const r = e.getBoundingClientRect();
      return { cls: e.className.toString().slice(0, 40), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: e.textContent?.slice(0, 30) };
    }),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
