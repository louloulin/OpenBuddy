import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-conv-"));
mkdirSync("/tmp/openbuddy-shots", { recursive: true });
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
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(800);

const firstSession = await page.$(".sidebar__conv");
if (firstSession) {
  await firstSession.click();
  await page.waitForTimeout(1500);
}

const r = await page.evaluate(() => {
  const b = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const t = (s) => { const el = document.querySelector(s); return el ? el.textContent.trim().slice(0, 60) : null; };
  // 顶栏现在多了什么
  const topbar = document.querySelector(".main-topbar");
  const topbarBtns = topbar ? Array.from(topbar.querySelectorAll("button, [role='button']")).map(b => ({ aria: b.getAttribute("aria-label") || "", text: (b.textContent||"").trim().slice(0, 25) })) : [];
  // chatview 内部
  const cv = document.querySelector(".chatview");
  const cvKids = cv ? Array.from(cv.children).map(c => ({ tag: c.tagName, cls: c.className.toString().slice(0, 50), h: Math.round(c.getBoundingClientRect().height) })) : [];
  // composer
  const composer = document.querySelector(".wb-composer");
  return {
    topbar: b(".main-topbar"),
    topbarBtns,
    chatview: b(".chatview"),
    cvKids,
    composer: b(".wb-composer"),
    composerHint: t(".wb-composer__hint"),
    pageErrors: window.__PAGE_ERRORS__ || [],
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
