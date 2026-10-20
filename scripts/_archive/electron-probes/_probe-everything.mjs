import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-everything-"));
mkdirSync("/tmp/ob-shots2", { recursive: true });

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

await page.screenshot({ path: "/tmp/ob-shots2/home.png" });

// Inspect 通知 button
const notifyInfo = await page.evaluate(() => {
  const btn = document.querySelector(".sidebar__footer .sidebar__icon-btn[aria-label='通知']");
  if (!btn) return null;
  return {
    hasDataTip: btn.hasAttribute("data-tip"),
    dataTip: btn.getAttribute("data-tip"),
    onClickType: typeof btn.onclick,
    classList: Array.from(btn.classList),
  };
});
console.log("通知 button:", JSON.stringify(notifyInfo, null, 2));

const settingsInfo = await page.evaluate(() => {
  const btn = document.querySelector(".sidebar__footer .sidebar__icon-btn[aria-label='设置']");
  if (!btn) return null;
  return {
    hasDataTip: btn.hasAttribute("data-tip"),
    dataTip: btn.getAttribute("data-tip"),
    classList: Array.from(btn.classList),
  };
});
console.log("设置 button:", JSON.stringify(settingsInfo, null, 2));

// Check if there's a visible separator above the footer
const separatorInfo = await page.evaluate(() => {
  const footer = document.querySelector(".sidebar__footer");
  if (!footer) return null;
  const cs = getComputedStyle(footer);
  const prev = footer.previousElementSibling;
  return {
    footerBorderTop: cs.borderTopWidth + " " + cs.borderTopStyle + " " + cs.borderTopColor,
    prevClass: prev?.className?.toString().slice(0, 60),
    prevRect: (() => { const r = prev.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
    footerRect: (() => { const r = footer.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
  };
});
console.log("\nFooter separator info:", JSON.stringify(separatorInfo, null, 2));

// Check sidebar status indicator
const statusInfo = await page.evaluate(() => {
  const el = document.querySelector(".sidebar__footer .status-indicator");
  if (!el) return { exists: false };
  const r = el.getBoundingClientRect();
  return {
    exists: true,
    cls: el.className,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    children: Array.from(el.children).map(c => ({ tag: c.tagName, text: c.textContent?.slice(0, 30) })),
  };
});
console.log("\nStatusIndicator in sidebar footer:", JSON.stringify(statusInfo, null, 2));

// Check sidebar visible content height
const sbScroll = await page.evaluate(() => {
  const sb = document.querySelector(".sidebar, .app__sidebar, aside.sidebar");
  if (!sb) return null;
  const content = sb.querySelector(".sidebar__content, .sidebar__body, .sidebar__main");
  const sb_r = sb.getBoundingClientRect();
  if (!content) {
    return {
      hasContent: false,
      sbHeight: sb_r.height,
      children: Array.from(sb.children).map(c => ({ tag: c.tagName, cls: c.className?.toString().slice(0, 40), h: Math.round(c.getBoundingClientRect().height) })),
    };
  }
  const c_r = content.getBoundingClientRect();
  return {
    hasContent: true,
    contentScrollH: content.scrollHeight,
    contentClientH: content.clientHeight,
    contentRect: { h: Math.round(c_r.height), w: Math.round(c_r.width) },
    sidebarHeight: Math.round(sb_r.height),
  };
});
console.log("\nSidebar scroll info:", JSON.stringify(sbScroll, null, 2));

await app.close();
